import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import type { HmrClient } from '@dsh-hmr/hmr-client';

export interface HmrToolDeps {
  client: HmrClient;
  /** Resolves when the service is reachable; spawns it in managed mode. */
  ready: () => Promise<unknown>;
}

function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }];
}

/**
 * Must stay identical to `MemoryObject.type` in `hmr/core/models.py` — the
 * service validates it as a pydantic Literal and answers 500 on anything else.
 */
const MEMORY_TYPES = [
  'concept',
  'project',
  'decision',
  'runtime',
  'task',
  'workflow',
  'agent_memory',
  'execution',
  'reflection',
] as const;

const THOUGHT_TYPES = ['observation', 'hypothesis', 'decision', 'action', 'insight'] as const;

/**
 * Register the five `hmr_*` tools on the harness tool registry.
 */
export function registerHmrTools(ctx: Context, deps: HmrToolDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'hmr_ingest',
      description:
        'Persist a durable memory into HMR long-term memory. Use it for decisions and the reasoning ' +
        'behind them, stable project context, reusable concepts, and post-execution reflections — ' +
        'not for transient scratch notes. HMR classifies, embeds, and indexes the memory so it can ' +
        'be recalled semantically in later sessions.',
      parameters: {
        content: {
          type: 'string',
          required: true,
          description: 'The memory itself. Self-contained: include the why, not just the what.',
        },
        memory_type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
          description:
            'Category hint; HMR rejects anything outside the enum. concept = reusable knowledge, ' +
            'project = project context, decision = choice + rationale, task/workflow/runtime/execution ' +
            '= operational traces, reflection = post-execution learning. Omit to let the memory policy classify it.',
        },
        title: {
          type: 'string',
          description: 'Short label used in recall results. Defaults to a derived summary.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-form tags for filtering.',
        },
        confidence: {
          type: 'number',
          description: 'How sure you are, 0..1. Defaults to the policy value.',
        },
        use_policy: {
          type: 'boolean',
          description: 'Let the memory policy decide type/confidence (default true).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            type: { type: 'string', required: true },
            title: { type: 'string', required: true },
            summary: { type: 'string' },
          },
        },
        render: (_args, value) =>
          text(`Stored memory ${value.id} (${value.type}): ${value.title}`),
      },
      execute: async (args) => {
        await deps.ready();
        const result = await deps.client.ingest({
          content: args.content,
          ...(args.memory_type ? { memory_type: args.memory_type } : {}),
          ...(args.title ? { title: args.title } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
          ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
          ...(args.use_policy !== undefined ? { use_policy: args.use_policy } : {}),
        });
        return {
          id: result.id,
          type: result.type,
          title: result.title,
          summary: result.summary ?? '',
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'hmr_recall',
      description:
        'Search HMR long-term memory by meaning. Returns the memories that best match the query plus ' +
        'HMR\'s reasoning trace for why they were selected. Call this before making a decision that ' +
        'may depend on earlier context, conventions, or past mistakes.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Natural-language description of what you need to remember.',
        },
        top_k: {
          type: 'integer',
          description: 'Maximum number of memories to return (default 5).',
        },
        strategy: {
          type: 'string',
          description: 'Optional retrieval strategy hint (e.g. semantic, temporal, graph).',
        },
        use_policy: {
          type: 'boolean',
          description: 'Let the memory policy choose the strategy (default true).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reasoning: { type: 'string', required: true },
            memories: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  type: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  content: { type: 'string', required: true },
                  summary: { type: 'string' },
                  score: { type: 'number', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.memories.length === 0) {
            return text(`No memories matched. ${value.reasoning}`.trim());
          }
          const lines = value.memories.map(
            (memory, index) =>
              `${index + 1}. [${memory.type}] ${memory.title} (score ${memory.score.toFixed(3)})\n${memory.content}`,
          );
          return text(`${value.reasoning}\n\n${lines.join('\n\n')}`);
        },
      },
      execute: async (args) => {
        await deps.ready();
        const result = await deps.client.recall({
          query: args.query,
          ...(args.top_k !== undefined ? { top_k: args.top_k } : {}),
          ...(args.strategy ? { strategy: args.strategy } : {}),
          ...(args.use_policy !== undefined ? { use_policy: args.use_policy } : {}),
        });
        return {
          reasoning: result.reasoning,
          memories: result.memories.map((memory) => ({
            id: memory.id,
            type: memory.type,
            title: memory.title,
            content: memory.content,
            summary: memory.summary ?? '',
            score: memory.score,
          })),
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'hmr_think',
      description:
        'Record an explicit reasoning chain in HMR. Use it for non-trivial decisions so a later ' +
        'session can inspect how the conclusion was reached rather than only seeing the outcome. ' +
        'Supplying the actual outcome triggers HMR reflection and returns actionable insights.',
      parameters: {
        goal: {
          type: 'string',
          required: true,
          description: 'What the chain is trying to decide or achieve.',
        },
        thoughts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              content: { type: 'string', required: true },
              type: { type: 'string', enum: [...THOUGHT_TYPES] },
              confidence: { type: 'number' },
            },
          },
          description: 'Ordered reasoning steps.',
        },
        actual_outcome: {
          type: 'string',
          description: 'What actually happened. Providing this triggers reflection.',
        },
        rating: {
          type: 'number',
          description: 'How well the chain worked out, 0..1.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chain_id: { type: 'string', required: true },
            goal: { type: 'string', required: true },
            thought_count: { type: 'integer', required: true },
            reflected: { type: 'boolean', required: true },
            insights: { type: 'array', required: true, items: { type: 'string' } },
            suggested_memory: { type: 'string' },
          },
        },
        render: (_args, value) => {
          const head = `Chain ${value.chain_id} recorded (${value.thought_count} thoughts).`;
          const insights =
            value.insights.length > 0
              ? `\n\nInsights:\n${value.insights.map((insight) => `- ${insight}`).join('\n')}`
              : '';
          const suggestion = value.suggested_memory
            ? `\n\nSuggested memory: ${value.suggested_memory}`
            : '';
          return text(`${head}${insights}${suggestion}`);
        },
      },
      execute: async (args) => {
        await deps.ready();
        const result = await deps.client.think({
          goal: args.goal,
          ...(args.thoughts ? { thoughts: args.thoughts.map((thought) => ({ ...thought })) } : {}),
          ...(args.actual_outcome ? { actual_outcome: args.actual_outcome } : {}),
          ...(args.rating !== undefined ? { rating: args.rating } : {}),
        });
        return {
          chain_id: result.chain_id,
          goal: result.goal,
          thought_count: result.thought_count,
          reflected: result.reflected,
          insights: result.insights,
          suggested_memory: result.suggested_memory ?? '',
        };
      },
      timeoutMs: 180_000,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'hmr_reflect',
      description:
        'Reflect on a finished piece of work: record what you intended, what actually happened, and ' +
        'how well it went. HMR compares the two, extracts insights, and proposes a memory worth ' +
        'keeping so the same mistake is not repeated next session.',
      parameters: {
        goal: {
          type: 'string',
          required: true,
          description: 'What you were trying to achieve.',
        },
        actual_outcome: {
          type: 'string',
          required: true,
          description: 'What actually happened, including surprises and failures.',
        },
        rating: {
          type: 'number',
          required: true,
          description: 'How well it went, 0..1.',
        },
        thoughts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              content: { type: 'string', required: true },
              type: { type: 'string', enum: [...THOUGHT_TYPES] },
              confidence: { type: 'number' },
            },
          },
          description: 'Optional reconstruction of the decisions taken along the way.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chain_id: { type: 'string', required: true },
            goal: { type: 'string', required: true },
            thought_count: { type: 'integer', required: true },
            reflected: { type: 'boolean', required: true },
            insights: { type: 'array', required: true, items: { type: 'string' } },
            suggested_memory: { type: 'string' },
          },
        },
        render: (_args, value) => {
          const insights =
            value.insights.length > 0
              ? value.insights.map((insight) => `- ${insight}`).join('\n')
              : '- (none extracted)';
          const suggestion = value.suggested_memory
            ? `\n\nSuggested memory: ${value.suggested_memory}`
            : '';
          return text(`Reflection on "${value.goal}":\n${insights}${suggestion}`);
        },
      },
      execute: async (args) => {
        await deps.ready();
        const result = await deps.client.think({
          goal: args.goal,
          actual_outcome: args.actual_outcome,
          rating: args.rating,
          ...(args.thoughts ? { thoughts: args.thoughts.map((thought) => ({ ...thought })) } : {}),
        });
        return {
          chain_id: result.chain_id,
          goal: result.goal,
          thought_count: result.thought_count,
          reflected: result.reflected,
          insights: result.insights,
          suggested_memory: result.suggested_memory ?? '',
        };
      },
      timeoutMs: 180_000,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'hmr_evolve',
      description:
        'Run an HMR self-evolution cycle: detect duplicate clusters and contradictions, abstract ' +
        'recurring patterns into higher-level knowledge, and prune what no longer earns its keep. ' +
        'Use dry_run first to inspect the proposed changes before applying them.',
      parameters: {
        dry_run: {
          type: 'boolean',
          description: 'Preview the changes without applying them (default true).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dry_run: { type: 'boolean', required: true },
            report: { type: 'json', required: true },
          },
        },
        render: (args, value) =>
          text(
            `HMR evolution (${args.dry_run === false ? 'applied' : 'dry run'}):\n` +
              JSON.stringify(value.report, null, 2),
          ),
      },
      execute: async (args) => {
        await deps.ready();
        const dryRun = args.dry_run !== false;
        const report = await deps.client.evolve(dryRun);
        return { dry_run: dryRun, report: report as never };
      },
      timeoutMs: 600_000,
      isConcurrencySafe: () => false,
    }),
  );
}

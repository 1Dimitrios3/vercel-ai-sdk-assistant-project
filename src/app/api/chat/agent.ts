import { DB } from '@/lib/persistence-layer';
import {
    Experimental_Agent as Agent,
    LanguageModel,
    StopCondition,
    ToolSet,
    hasToolCall,
    UIMessageStreamWriter
} from 'ai';
import { getTools, MyMessage } from './route';
import { makeHITLToolSet } from './hitl';
import { getSystemPrompt } from './prompts/prompts';

export const createAgent = (opts: {
    messages: MyMessage[];
    model: LanguageModel;
    stopWhen: StopCondition<any>;
    memories: {
        score: number;
        item: DB.Memory
    }[];
    relatedChats: DB.Chat[];
    mcpTools: ToolSet;
    writer?: UIMessageStreamWriter;
}) =>
    new Agent({
        model: opts.model,
        tools: {
            ...getTools(opts.messages),
            // Wrap MCP tools to request approval
            ...makeHITLToolSet(opts.mcpTools, opts.writer)
        },
        // Stop on any MCP tool call for user approval
        stopWhen: [
            opts.stopWhen,
            ...Object.keys(opts.mcpTools).map((toolName) => hasToolCall(toolName))
        ],
        system: getSystemPrompt(opts.memories, []),
    });
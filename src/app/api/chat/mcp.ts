// src/app/api/chat/mcp.ts
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { ToolSet } from 'ai';

const deleteUnwantedTools = (tools: ToolSet) => {
    if ('add_tools' in tools) {
        delete tools.add_tools;
    }
    if ('edit_tools' in tools) {
        delete tools.edit_tools;
    }

    return tools;
};
export const getMCPTools = async () => {
    // Create HTTP client to connect to MCP server
    const httpClient = await experimental_createMCPClient({
        transport: {
            type: 'http',
            url: process.env.MCP_URL!,
        },
    });

    // Fetch available tools from the MCP server
    const tools = await httpClient.tools();

    // DEBUG check all mcp tools available
    // for (const tool of Object.keys(tools)) {
    //   console.log(tool, (tools[tool].inputSchema as any).jsonSchema);
    // }

    return deleteUnwantedTools(tools as ToolSet);
};
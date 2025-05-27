const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json({ limit: '10mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Store active SSE connections
const activeConnections = new Map();

// Pollinations API client
class PollinationsClient {
  constructor() {
    this.imageBaseUrl = 'https://image.pollinations.ai/prompt';
    this.textBaseUrl = 'https://text.pollinations.ai';
  }

  async generateImage(prompt, options = {}) {
    try {
      const { width = 1024, height = 1024, model = 'flux', seed } = options;
      const params = new URLSearchParams({
        width: width.toString(),
        height: height.toString(),
        model,
        nologo: 'true',
        nofeed: 'true',
        ...(seed && { seed: seed.toString() })
      });

      const imageUrl = `${this.imageBaseUrl}/${encodeURIComponent(prompt)}?${params}`;
      console.log(`Generating image: ${prompt.substring(0, 50)}...`);
      
      const response = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000 
      });
      
      const base64 = Buffer.from(response.data).toString('base64');
      return {
        success: true,
        base64,
        url: imageUrl,
        contentType: response.headers['content-type'] || 'image/png'
      };
    } catch (error) {
      console.error('Image generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async generateText(prompt, model = 'openai') {
    try {
      console.log(`Generating text with ${model}: ${prompt.substring(0, 50)}...`);
      
      const response = await axios.post(`${this.textBaseUrl}/${model}`, {
        messages: [{ role: 'user', content: prompt }],
        jsonMode: false
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      return {
        success: true,
        content: response.data
      };
    } catch (error) {
      console.error('Text generation failed:', error.message);
      throw new Error(`Text generation failed: ${error.message}`);
    }
  }

  getAvailableModels() {
    return {
      image: ['flux', 'turbo', 'flux-realism', 'flux-cablyai', 'any-dark'],
      text: ['openai', 'mistral', 'claude', 'llama', 'gemini']
    };
  }
}

const pollinations = new PollinationsClient();

// MCP Protocol Handler
class MCPHandler {
  constructor(connectionId, res) {
    this.connectionId = connectionId;
    this.res = res;
    this.tools = [
      {
        name: 'generate_image',
        description: 'Generate an image from a text prompt using Pollinations AI',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Text description of the image to generate'
            },
            width: {
              type: 'number',
              description: 'Image width in pixels (default: 1024)',
              default: 1024
            },
            height: {
              type: 'number', 
              description: 'Image height in pixels (default: 1024)',
              default: 1024
            },
            model: {
              type: 'string',
              description: 'Image generation model to use',
              enum: ['flux', 'turbo', 'flux-realism', 'flux-cablyai', 'any-dark'],
              default: 'flux'
            },
            seed: {
              type: 'number',
              description: 'Random seed for reproducible results (optional)'
            }
          },
          required: ['prompt']
        }
      },
      {
        name: 'generate_text',
        description: 'Generate text content using Pollinations AI language models',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Text prompt for content generation'
            },
            model: {
              type: 'string',
              description: 'Language model to use for generation',
              enum: ['openai', 'mistral', 'claude', 'llama', 'gemini'],
              default: 'openai'
            }
          },
          required: ['prompt']
        }
      },
      {
        name: 'list_models',
        description: 'List all available models for image and text generation',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ];
  }

  async handleMessage(message) {
    try {
      console.log(`Received MCP message (${this.connectionId}):`, JSON.stringify(message, null, 2));

      const response = await this.processMessage(message);
      this.sendMessage(response);
    } catch (error) {
      console.error(`Error handling MCP message (${this.connectionId}):`, error);
      this.sendError(message.id, -32603, 'Internal error', error.message);
    }
  }

  async processMessage(message) {
    const { id, method, params } = message;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: true },
              resources: {},
              prompts: {}
            },
            serverInfo: {
              name: 'pollinations-mcp-server',
              version: '1.0.0'
            }
          }
        };

      case 'notifications/initialized':
        // No response needed for notifications
        return null;

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.tools
          }
        };

      case 'tools/call':
        const toolResult = await this.callTool(params.name, params.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(toolResult, null, 2)
              }
            ]
          }
        };

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async callTool(toolName, args) {
    console.log(`Calling tool: ${toolName} with args:`, args);

    switch (toolName) {
      case 'generate_image':
        const imageResult = await pollinations.generateImage(args.prompt, {
          width: args.width,
          height: args.height,
          model: args.model,
          seed: args.seed
        });
        return {
          tool: 'generate_image',
          result: imageResult,
          metadata: {
            prompt: args.prompt,
            timestamp: new Date().toISOString()
          }
        };

      case 'generate_text':
        const textResult = await pollinations.generateText(args.prompt, args.model);
        return {
          tool: 'generate_text',
          result: textResult,
          metadata: {
            prompt: args.prompt,
            model: args.model,
            timestamp: new Date().toISOString()
          }
        };

      case 'list_models':
        return {
          tool: 'list_models',
          result: pollinations.getAvailableModels(),
          metadata: {
            timestamp: new Date().toISOString()
          }
        };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  sendMessage(message) {
    if (message) {
      const data = `data: ${JSON.stringify(message)}\n\n`;
      this.res.write(data);
      console.log(`Sent MCP response (${this.connectionId})`);
    }
  }

  sendError(id, code, message, data = null) {
    const errorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };
    this.sendMessage(errorResponse);
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Pollinations MCP Server is running!',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      sse: '/sse',
      message: '/message',
      test: '/api/test'
    },
    tools: ['generate_image', 'generate_text', 'list_models']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    port: PORT,
    uptime: process.uptime(),
    activeConnections: activeConnections.size,
    version: '1.0.0'
  });
});

// Main SSE endpoint for MCP protocol
app.get('/sse', (req, res) => {
  console.log('New SSE connection request');
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Authorization'
  });

  const connectionId = Date.now().toString();
  console.log(`SSE connection established: ${connectionId}`);

  // Create MCP handler for this connection
  const mcpHandler = new MCPHandler(connectionId, res);
  activeConnections.set(connectionId, { res, mcpHandler });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({
    type: 'connection',
    connectionId,
    message: 'Connected to Pollinations MCP Server',
    serverInfo: {
      name: 'pollinations-mcp-server',
      version: '1.0.0',
      capabilities: ['image_generation', 'text_generation', 'model_listing']
    }
  })}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`SSE connection closed: ${connectionId}`);
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });

  req.on('error', (error) => {
    console.error(`SSE connection error (${connectionId}):`, error);
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });
});

// Endpoint to send MCP messages
app.post('/message', async (req, res) => {
  try {
    const message = req.body;
    console.log('Received MCP message:', JSON.stringify(message, null, 2));
    
    const connectionId = req.headers['x-connection-id'] || Array.from(activeConnections.keys())[0];

    if (!connectionId || !activeConnections.has(connectionId)) {
      return res.status(404).json({ 
        error: 'Connection not found',
        availableConnections: Array.from(activeConnections.keys())
      });
    }

    const { mcpHandler } = activeConnections.get(connectionId);
    await mcpHandler.handleMessage(message);

    res.json({ success: true, connectionId });
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API test successful',
    timestamp: new Date().toISOString(),
    port: PORT,
    endpoints: ['/health', '/sse', '/message', '/api/test'],
    tools: ['generate_image', 'generate_text', 'list_models'],
    activeConnections: activeConnections.size
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: ['/', '/health', '/sse', '/message', '/api/test']
  });
});

// Graceful shutdown handling
let server;

function shutdown() {
  console.log('Shutting down gracefully...');
  
  // Close all active SSE connections
  for (const [connectionId, { res }] of activeConnections) {
    res.end();
  }
  
  if (server) {
    server.close((err) => {
      if (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
      console.log('Server closed successfully');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Pollinations MCP Server running on port ${PORT}`);
  console.log(`📡 Available endpoints:`);
  console.log(`   GET / - Server info`);
  console.log(`   GET /health - Health check`);
  console.log(`   GET /sse - SSE endpoint for MCP protocol (n8n)`);
  console.log(`   POST /message - Send MCP messages`);
  console.log(`   GET /api/test - Test endpoint`);
  console.log(`🎯 Available tools: generate_image, generate_text, list_models`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

module.exports = app;

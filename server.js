const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const axios = require('axios');

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

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
      logger.info(`Generating image: ${prompt.substring(0, 50)}...`);
      
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
      logger.error('Image generation failed:', error.message);
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async generateText(prompt, model = 'openai') {
    try {
      logger.info(`Generating text with ${model}: ${prompt.substring(0, 50)}...`);
      
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
      logger.error('Text generation failed:', error.message);
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
      logger.debug(`Received MCP message (${this.connectionId}):`, message);

      const response = await this.processMessage(message);
      this.sendMessage(response);
    } catch (error) {
      logger.error(`Error handling MCP message (${this.connectionId}):`, error);
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
    logger.info(`Calling tool: ${toolName} with args:`, args);

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
      logger.debug(`Sent MCP response (${this.connectionId}):`, message);
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeConnections: activeConnections.size,
    uptime: process.uptime(),
    version: '1.0.0',
    environment: {
      project: process.env.PROJECT_NAME || 'unknown',
      service: process.env.SERVICE_NAME || 'unknown',
      domain: process.env.PRIMARY_DOMAIN || 'unknown'
    }
  });
});

// Main SSE endpoint for MCP protocol
app.get('/sse', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Authorization'
  });

  const connectionId = Date.now().toString();
  logger.info(`New SSE connection: ${connectionId}`);

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
    logger.info(`SSE connection closed: ${connectionId}`);
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });

  req.on('error', (error) => {
    logger.error(`SSE connection error (${connectionId}):`, error);
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });
});

// Endpoint to send MCP messages (used by n8n MCP client)
app.post('/message', async (req, res) => {
  try {
    const message = req.body;
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
    logger.error('Error processing message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Alternative unified endpoint for different MCP clients
app.all('/mcp', async (req, res) => {
  if (req.method === 'GET') {
    // Handle SSE connection
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Authorization'
    });

    const connectionId = `mcp-${Date.now()}`;
    logger.info(`MCP SSE connection established: ${connectionId}`);

    const mcpHandler = new MCPHandler(connectionId, res);
    activeConnections.set(connectionId, { res, mcpHandler });

    // Send connection confirmation
    res.write(`data: ${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/connection',
      params: {
        connectionId,
        serverInfo: {
          name: 'pollinations-mcp-server',
          version: '1.0.0'
        }
      }
    })}\n\n`);

    // Keep alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 30000);

    req.on('close', () => {
      logger.info(`MCP connection closed: ${connectionId}`);
      clearInterval(keepAlive);
      activeConnections.delete(connectionId);
    });

  } else if (req.method === 'POST') {
    // Handle MCP message
    try {
      const message = req.body;
      
      // Use the first available connection or create a temporary handler
      const firstConnection = Array.from(activeConnections.values())[0];
      
      if (!firstConnection) {
        return res.status(404).json({ 
          jsonrpc: '2.0',
          id: message.id,
          error: { 
            code: -32001, 
            message: 'No active MCP connection',
            data: 'Please establish SSE connection first'
          }
        });
      }

      await firstConnection.mcpHandler.handleMessage(message);
      res.json({ success: true, message: 'MCP message processed' });
      
    } catch (error) {
      logger.error('Error processing MCP message:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id,
        error: { 
          code: -32603, 
          message: 'Internal error', 
          data: error.message 
        }
      });
    }
  }
});

// Simple API endpoint for testing
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Pollinations MCP Server is running!',
    endpoints: {
      health: '/health',
      sse: '/sse',
      message: '/message',
      mcp: '/mcp'
    },
    tools: ['generate_image', 'generate_text', 'list_models'],
    timestamp: new Date().toISOString(),
    easypanel: {
      project: process.env.PROJECT_NAME || 'not-set',
      service: process.env.SERVICE_NAME || 'not-set',
      domain: process.env.PRIMARY_DOMAIN || 'not-set'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
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
    availableEndpoints: ['/health', '/sse', '/message', '/mcp', '/api/test']
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down MCP server...');
  
  // Close all active connections
  for (const [connectionId, { res }] of activeConnections) {
    res.end();
  }
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  // Close all active connections
  for (const [connectionId, { res }] of activeConnections) {
    res.end();
  }
  
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  // Use EasyPanel magic variables for proper URL construction
  const primaryDomain = process.env.PRIMARY_DOMAIN;
  const baseUrl = primaryDomain ? `https://${primaryDomain}` : `http://localhost:${PORT}`;
  
  logger.info(`🚀 Pollinations MCP Server running on port ${PORT}`);
  logger.info('📡 Available endpoints:');
  logger.info('  GET /health - Health check');
  logger.info('  GET /sse - SSE endpoint for MCP protocol (n8n)');
  logger.info('  POST /message - Send MCP messages');
  logger.info('  GET|POST /mcp - Unified MCP endpoint');
  logger.info('  GET /api/test - Test endpoint');
  logger.info('');
  logger.info(`🔗 For n8n MCP Client, use: ${baseUrl}/sse`);
  logger.info(`🎯 Available tools: generate_image, generate_text, list_models`);
  
  // Log EasyPanel environment info
  if (process.env.NODE_ENV === 'production') {
    logger.info(`🌐 EasyPanel Info:`);
    logger.info(`   Project: ${process.env.PROJECT_NAME || 'not-set'}`);
    logger.info(`   Service: ${process.env.SERVICE_NAME || 'not-set'}`);
    logger.info(`   Domain: ${process.env.PRIMARY_DOMAIN || 'not-set'}`);
    logger.info(`   Server accessible at: ${baseUrl}`);
  }
});

module.exports = app;

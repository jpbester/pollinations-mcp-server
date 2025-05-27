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

// Store active connections and their message queues
const activeConnections = new Map();
const messageQueue = new Map();

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

// MCP Tools Definition
const MCP_TOOLS = [
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

// MCP Message Processor
class MCPProcessor {
  constructor() {
    this.initialized = false;
  }

  async processMessage(message, connectionId) {
    const { id, method, params } = message;
    
    console.log(`[${connectionId}] Processing MCP: ${method} (ID: ${id})`);

    try {
      switch (method) {
        case 'initialize':
          this.initialized = true;
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
          console.log(`[${connectionId}] Client initialized notification received`);
          return null; // No response for notifications

        case 'tools/list':
          if (!this.initialized) {
            throw new Error('Server not initialized');
          }
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: MCP_TOOLS
            }
          };

        case 'tools/call':
          if (!this.initialized) {
            throw new Error('Server not initialized');
          }
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
    } catch (error) {
      console.error(`[${connectionId}] Error processing ${method}:`, error.message);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      };
    }
  }

  async callTool(toolName, args) {
    console.log(`Calling tool: ${toolName}`);

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
}

const mcpProcessor = new MCPProcessor();

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

// MCP-compliant SSE endpoint
app.get('/sse', (req, res) => {
  const connectionId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${connectionId}] New MCP SSE connection from ${req.ip}`);
  
  // Set proper SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Authorization',
    'X-Accel-Buffering': 'no'
  });

  // Store connection
  activeConnections.set(connectionId, {
    res,
    connectionId,
    connected: true,
    lastPing: Date.now()
  });

  messageQueue.set(connectionId, []);

  console.log(`[${connectionId}] SSE connection established`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    const connection = activeConnections.get(connectionId);
    if (connection && connection.connected && !connection.res.destroyed) {
      connection.res.write(`: keepalive ${Date.now()}\n\n`);
      connection.lastPing = Date.now();
    } else {
      clearInterval(keepAlive);
      activeConnections.delete(connectionId);
      messageQueue.delete(connectionId);
    }
  }, 10000); // 10 seconds

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[${connectionId}] SSE connection closed`);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
    messageQueue.delete(connectionId);
  });

  req.on('error', (error) => {
    console.error(`[${connectionId}] SSE connection error:`, error);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
    messageQueue.delete(connectionId);
  });

  res.on('error', (error) => {
    console.error(`[${connectionId}] SSE response error:`, error);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
    messageQueue.delete(connectionId);
  });
});

// Handle MCP messages via POST to /sse
app.post('/sse', async (req, res) => {
  try {
    const message = req.body;
    const connectionId = req.headers['x-connection-id'] || req.headers['connection-id'];
    
    console.log(`[${connectionId || 'unknown'}] Received MCP message:`, JSON.stringify(message, null, 2));
    
    if (!message.jsonrpc || message.jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: message.id || null,
        error: {
          code: -32600,
          message: 'Invalid Request - missing or invalid jsonrpc version'
        }
      });
    }

    // Process the message
    const response = await mcpProcessor.processMessage(message, connectionId || 'direct');
    
    if (response) {
      // If we have a specific connection, send to that SSE stream
      if (connectionId && activeConnections.has(connectionId)) {
        const connection = activeConnections.get(connectionId);
        if (connection.connected && !connection.res.destroyed) {
          connection.res.write(`data: ${JSON.stringify(response)}\n\n`);
          console.log(`[${connectionId}] Response sent via SSE`);
        }
      } else {
        // Send to all active connections (fallback)
        let sent = false;
        for (const [connId, connection] of activeConnections) {
          if (connection.connected && !connection.res.destroyed) {
            connection.res.write(`data: ${JSON.stringify(response)}\n\n`);
            sent = true;
          }
        }
        if (sent) {
          console.log(`Response sent to ${activeConnections.size} SSE connections`);
        }
      }
      
      res.json({ success: true, messageId: message.id });
    } else {
      res.json({ success: true, messageId: message.id, note: 'Notification processed' });
    }
    
  } catch (error) {
    console.error('Error processing MCP message:', error);
    
    const errorResponse = {
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error.message
      }
    };
    
    res.status(500).json(errorResponse);
  }
});

// Simple HTTP endpoint for direct MCP communication (alternative)
app.post('/mcp', async (req, res) => {
  try {
    const message = req.body;
    console.log('Direct MCP message:', JSON.stringify(message, null, 2));
    
    const response = await mcpProcessor.processMessage(message, 'direct');
    
    if (response) {
      res.json(response);
    } else {
      res.json({ success: true, note: 'Notification processed' });
    }
    
  } catch (error) {
    console.error('Error processing direct MCP message:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error.message
      }
    });
  }
});

// Test SSE endpoint
app.get('/test-sse', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>MCP SSE Test</title></head>
    <body>
      <h1>MCP SSE Connection Test</h1>
      <div>
        <button onclick="testInitialize()">Test Initialize</button>
        <button onclick="testToolsList()">Test Tools List</button>
        <button onclick="testImageGen()">Test Image Generation</button>
      </div>
      <div id="messages" style="margin-top: 20px; padding: 10px; border: 1px solid #ccc; height: 400px; overflow-y: scroll;"></div>
      
      <script>
        const eventSource = new EventSource('/sse');
        const messages = document.getElementById('messages');
        
        function addMessage(msg, type = 'info') {
          const div = document.createElement('div');
          div.innerHTML = '<strong>' + new Date().toLocaleTimeString() + '</strong> [' + type + ']: ' + msg;
          div.style.color = type === 'error' ? 'red' : (type === 'success' ? 'green' : 'black');
          messages.appendChild(div);
          messages.scrollTop = messages.scrollHeight;
        }
        
        eventSource.onopen = function(event) {
          addMessage('SSE connection opened', 'success');
        };
        
        eventSource.onmessage = function(event) {
          addMessage('Received: ' + event.data, 'info');
        };
        
        eventSource.onerror = function(event) {
          addMessage('SSE Error: ' + JSON.stringify(event), 'error');
        };
        
        async function testInitialize() {
          const message = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'test-client', version: '1.0.0' }
            }
          };
          
          const response = await fetch('/sse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
          
          const result = await response.json();
          addMessage('Initialize response: ' + JSON.stringify(result), 'success');
        }
        
        async function testToolsList() {
          const message = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
          };
          
          const response = await fetch('/sse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
          
          const result = await response.json();
          addMessage('Tools list response: ' + JSON.stringify(result), 'success');
        }
        
        async function testImageGen() {
          const message = {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'generate_image',
              arguments: {
                prompt: 'A beautiful sunset',
                width: 512,
                height: 512
              }
            }
          };
          
          const response = await fetch('/sse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
          
          const result = await response.json();
          addMessage('Image generation response received', 'success');
        }
      </script>
    </body>
    </html>
  `);
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API test successful',
    timestamp: new Date().toISOString(),
    port: PORT,
    endpoints: ['/', '/health', '/sse', '/mcp', '/api/test', '/test-sse'],
    tools: ['generate_image', 'generate_text', 'list_models'],
    activeConnections: activeConnections.size,
    mcpInitialized: mcpProcessor.initialized
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
    availableEndpoints: ['/', '/health', '/sse', '/mcp', '/api/test', '/test-sse']
  });
});

// Graceful shutdown
let server;

function shutdown() {
  console.log('Shutting down gracefully...');
  
  // Close all active SSE connections
  for (const [connectionId, connection] of activeConnections) {
    if (connection.connected && !connection.res.destroyed) {
      connection.res.end();
    }
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
  console.log(`📡 MCP SSE Endpoint: /sse`);
  console.log(`📡 Direct MCP Endpoint: /mcp`);
  console.log(`📡 Test Page: /test-sse`);
  console.log(`🎯 Available tools: generate_image, generate_text, list_models`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

module.exports = app;

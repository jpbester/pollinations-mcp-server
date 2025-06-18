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

// Store active connections
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
                // Note: We are not adding connectionId here, it's sent via a separate system event
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Authorization',
    'X-Accel-Buffering': 'no'
  });

  const newConnection = {
    res,
    connectionId,
    connected: true,
    lastPing: Date.now()
  };
  activeConnections.set(connectionId, newConnection);

  console.log(`[${connectionId}] SSE connection established`);

  // Send connection_ready event to the client
  if (newConnection.connected && !newConnection.res.destroyed) {
    newConnection.res.write(`event: system\ndata: ${JSON.stringify({ type: "connection_ready", connectionId })}\n\n`);
    console.log(`[${connectionId}] Sent connection_ready event.`);
  }

  const keepAlive = setInterval(() => {
    const connection = activeConnections.get(connectionId);
    if (connection && connection.connected && !connection.res.destroyed) {
      connection.res.write(`: keepalive ${Date.now()}\n\n`);
      connection.lastPing = Date.now();
    } else {
      clearInterval(keepAlive);
      activeConnections.delete(connectionId);
    }
  }, 10000);

  req.on('close', () => {
    console.log(`[${connectionId}] SSE connection closed`);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });

  req.on('error', (error) => {
    console.error(`[${connectionId}] SSE connection error:`, error);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });

  res.on('error', (error) => {
    console.error(`[${connectionId}] SSE response error:`, error);
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.connected = false;
    }
    clearInterval(keepAlive);
    activeConnections.delete(connectionId);
  });
});

// Handle MCP messages via POST to /sse
app.post('/sse', async (req, res) => {
  try {
    const message = req.body;
    const connectionId = req.headers['x-connection-id']; // Use specific header

    console.log(`[${connectionId || 'unknown'}] Received MCP POST to /sse:`, JSON.stringify(message, null, 2));

    if (!message || !message.jsonrpc || message.jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: message?.id || null,
        error: {
          code: -32600,
          message: 'Invalid Request - missing or invalid jsonrpc version or malformed message body'
        }
      });
    }

    const sseBoundMethods = ['initialize', 'tools/list', 'tools/call'];
    const requiresSseDelivery = sseBoundMethods.includes(message.method);

    if (requiresSseDelivery) {
      if (!connectionId) {
        return res.status(400).json({
          jsonrpc: '2.0',
          id: message.id || null,
          error: {
            code: -32001,
            message: 'Missing X-Connection-ID for SSE-bound request.'
          }
        });
      }
      if (!activeConnections.has(connectionId)) {
        // This specific connection ID is not active
        return res.status(400).json({
          jsonrpc: '2.0',
          id: message.id || null,
          error: {
            code: -32001,
            message: `Invalid X-Connection-ID: No active SSE connection found for ID '${connectionId}'.`
          }
        });
      }
    }

    const processorConnectionContext = connectionId || `http-post-${message.method || 'unknown'}-${Date.now()}`;
    const responseFromProcessor = await mcpProcessor.processMessage(message, processorConnectionContext);

    if (responseFromProcessor) {
      const connection = activeConnections.get(connectionId);

      if (requiresSseDelivery && connection && connection.connected && !connection.res.destroyed) {
        res.status(202).json({
          jsonrpc: "2.0",
          id: message.id || null,
          result: { status: "received", messageId: message.id || null }
        });
        connection.res.write(`event: mcp\ndata: ${JSON.stringify(responseFromProcessor)}\n\n`);
        console.log(`[${connectionId}] MCP response for ${message.method} (ID: ${message.id}) sent via SSE.`);
      } else if (requiresSseDelivery) {
        console.error(`[${connectionId}] SSE connection for ${message.method} (ID: ${message.id}) lost or invalid before message dispatch.`);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                id: message.id || null,
                error: { code: -32002, message: 'SSE connection lost before message could be sent over stream.'}
            });
        }
      } else {
        console.warn(`[${processorConnectionContext}] Response for ${message.method} (ID: ${message.id}) will be sent via HTTP body as it's not an SSE-exclusive method or no valid SSE target.`);
        res.json(responseFromProcessor);
      }
    } else {
      console.log(`[${processorConnectionContext}] Processed notification: ${message.method} (ID: ${message.id}). Sending 204 No Content.`);
      res.status(204).send();
    }

  } catch (error) {
    const messageId = req.body?.id || null;
    const method = req.body?.method || 'unknown method';
    console.error(`[${req.headers['x-connection-id'] || 'unknown'}] Error processing MCP POST for ${method} (ID: ${messageId}):`, error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: messageId,
        error: {
          code: -32603,
          message: 'Internal server error during POST /sse processing.',
          data: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
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
      res.json({ success: true, messageId: message.id, note: 'Notification processed or no direct response required.' });
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
    <head>
      <title>MCP SSE Test</title>
      <style>
        #messages div { margin-bottom: 5px; padding-bottom: 5px; border-bottom: 1px solid #eee; }
        #messages strong { margin-right: 5px; }
      </style>
    </head>
    <body>
      <h1>MCP SSE Connection Test</h1>
      <p>Status: <span id="status">Connecting...</span> | Connection ID: <span id="connectionIdDisplay">N/A</span></p>
      <div>
        <button onclick="testInitialize()">Test Initialize</button>
        <button onclick="testToolsList()">Test Tools List</button>
        <button onclick="testImageGen()">Test Image Generation</button>
      </div>
      <div id="messages" style="margin-top: 20px; padding: 10px; border: 1px solid #ccc; height: 400px; overflow-y: scroll; font-family: monospace; font-size: 0.9em;"></div>

      <script>
        let connectionId = null; // Renamed from sseConnectionId
        const messagesDiv = document.getElementById('messages');
        const statusSpan = document.getElementById('status');
        const connectionIdDisplaySpan = document.getElementById('connectionIdDisplay');

        const eventSource = new EventSource('/sse');

        function addMessage(msg, type = 'info') { // type can be 'info', 'error', 'success', 'system', 'mcp', 'system-warn', 'http-ack'
          const div = document.createElement('div');
          let color = 'black';
          let typeDisplay = type.toUpperCase();

          switch (type) {
            case 'error': color = 'red'; break;
            case 'success': color = 'green'; break;
            case 'system': color = 'blue'; break;
            case 'system-warn': color = 'orange'; typeDisplay = 'SYSTEM-WARN'; break;
            case 'mcp': color = 'purple'; break;
            case 'http-ack': color = 'DarkCyan'; typeDisplay = 'HTTP-ACK'; break;
            default: typeDisplay = 'INFO'; break;
          }
          // Sanitize msg to prevent HTML injection if it contains user input or unexpected chars
          const textNode = document.createTextNode(msg);
          const strong = document.createElement('strong');
          strong.textContent = new Date().toLocaleTimeString() + ' [' + typeDisplay + ']: ';

          div.appendChild(strong);
          div.appendChild(textNode);
          div.style.color = color;
          messagesDiv.appendChild(div);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        eventSource.onopen = function(event) {
          statusSpan.textContent = 'SSE Connection Opened';
          addMessage('SSE connection stream opened.', 'success');
        };

        eventSource.addEventListener('system', function(event) {
          try {
              const parsedData = JSON.parse(event.data);
              if (parsedData.type === 'connection_ready' && parsedData.connectionId) {
                  connectionId = parsedData.connectionId;
                  statusSpan.textContent = 'Connected';
                  connectionIdDisplaySpan.textContent = connectionId;
                  addMessage('Successfully connected with ID: ' + connectionId, 'system');
              } else {
                  addMessage('Received System Event: ' + event.data, 'system');
              }
          } catch (e) {
              addMessage('Received non-JSON system event: ' + event.data, 'system-warn');
          }
        });

        eventSource.addEventListener('mcp', function(event) {
            addMessage('Received MCP Event: ' + event.data, 'mcp');
        });

        eventSource.onmessage = function(event) { // Generic message handler for non-typed events
            // This will catch the : keepalive messages if not handled otherwise.
            if (event.data && event.data.startsWith(': keepalive')) {
                 addMessage('Keepalive ping.', 'info');
            } else {
                 addMessage('Received Generic SSE: ' + event.data, 'info');
            }
        };

        eventSource.onerror = function(event) {
          statusSpan.textContent = 'Error / Closed';
          connectionIdDisplaySpan.textContent = 'N/A';
          addMessage('SSE Error: ' + (event.message || 'Connection failed or closed.'), 'error');
          console.error("SSE Error Details:", event);
        };

        async function postSseMessage(message) {
          if (!connectionId) {
            addMessage('Error: SSE Connection ID not yet captured. Cannot send request. Wait for "SYSTEM: Successfully connected" message.', 'error');
            return;
          }

          const headers = {
            'Content-Type': 'application/json',
            'X-Connection-ID': connectionId
          };

          addMessage(\`Sending POST to /sse (X-Connection-ID: \${connectionId}): \${JSON.stringify(message)}\`, 'info');

          try {
            const response = await fetch('/sse', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(message)
            });

            const responseText = await response.text();
            let resultJson;
            try {
              resultJson = JSON.parse(responseText);
            } catch (e) {
              resultJson = { error: "Failed to parse response as JSON", data: responseText, status: response.status };
            }

            if (response.ok) {
              let messageType = 'info';
              let messagePrefix = (message.method || 'Request');
              if (response.status === 202) {
                  messageType = 'http-ack';
                  addMessage(\`\${messagePrefix} HTTP \${response.status} Ack: \${JSON.stringify(resultJson)}. Actual result expected via SSE.\`, messageType);
              } else if (response.status === 204) {
                  messageType = 'success';
                  addMessage(\`\${messagePrefix} HTTP \${response.status} Success (No Content).\`, messageType);
              } else {
                  addMessage(\`\${messagePrefix} HTTP \${response.status} Response: \${JSON.stringify(resultJson)}\`, messageType);
              }
            } else {
              addMessage((message.method || 'Request') + ' HTTP error ' + response.status + ': ' + JSON.stringify(resultJson), 'error');
            }
          } catch (fetchError) {
              addMessage('Fetch API error when posting to /sse: ' + fetchError.message, 'error');
              console.error('Fetch error:', fetchError);
          }
        }

        async function testInitialize() {
          await postSseMessage({
            jsonrpc: '2.0',
            id: "init-" + Date.now(),
            method: 'initialize',
            params: { clientName: 'TestClient/1.0' }
          });
        }

        async function testToolsList() {
          await postSseMessage({
            jsonrpc: '2.0',
            id: "toolslist-" + Date.now(),
            method: 'tools/list'
          });
        }

        async function testImageGen() {
          await postSseMessage({
            jsonrpc: '2.0',
            id: "toolscall-img-" + Date.now(),
            method: 'tools/call',
            params: {
              name: 'generate_image',
              arguments: { prompt: 'A colorful bird on a branch', width: 512, height: 512 }
            }
          });
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

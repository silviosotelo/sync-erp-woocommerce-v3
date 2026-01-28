class SystemController {
  constructor(syncService, processor, logger) {
    this.syncService = syncService;
    this.processor = processor;
    this.logger = logger;
    
    // OPTIMIZACIÓN: Guardar referencia a la última prueba de conexión
    this.lastConnectionTest = null;
    this.connectionTestCache = null;
    this.CACHE_DURATION = 30000; // 30 segundos
  }

  async getConfig(req, res) {
    try {
      const config = {
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3001,

        sync: {
          autoSyncEnabled: process.env.AUTO_SYNC_ENABLED === 'true',
          intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 10,
          batchSize: parseInt(process.env.SYNC_BATCH_SIZE) || 100,
          maxRetries: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
          timeoutSeconds: parseInt(process.env.PROCESSING_TIMEOUT_MS) / 1000 || 30
        },

        erp: {
          endpoint: process.env.ERP_ENDPOINT || 'N/A',
          timeout: parseInt(process.env.ERP_TIMEOUT) || 30000,
          retryAttempts: parseInt(process.env.ERP_RETRY_ATTEMPTS) || 3
        },

        database: {
          host: process.env.MYSQL_HOST || 'N/A',
          database: process.env.MYSQL_DATABASE || 'N/A',
          prefix: process.env.DB_PREFIX || 'wp_',
          connected: this.processor !== null
        },

        features: {
          multiInventory: process.env.MULTI_INVENTORY_ENABLED === 'true',
          stockSync: process.env.STOCK_SYNC_ENABLED === 'true',
          dailyReport: process.env.DAILY_REPORT_ENABLED === 'true',
          realtimeUpdates: process.env.REALTIME_UPDATES === 'true',
          whatsapp: process.env.WHATSAPP_ENABLED === 'true'
        },

        notifications: {
          onStart: process.env.NOTIFY_ON_START === 'true',
          onComplete: process.env.NOTIFY_ON_COMPLETE === 'true',
          onError: process.env.NOTIFY_ON_ERROR === 'true',
          errorThreshold: parseInt(process.env.ERROR_THRESHOLD_PERCENT) || 10
        }
      };

      res.json(config);
    } catch (error) {
      this.logger.error('Error obteniendo configuración:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getStatus(req, res) {
    try {
      const status = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),

        connections: {
          mysql: {
            connected: this.processor !== null,
            message: this.processor ? 'Conectado' : 'No disponible - Modo solo lectura'
          },
          erp: {
            endpoint: process.env.ERP_ENDPOINT,
            status: 'Configurado'
          }
        },

        services: {
          syncService: this.syncService !== null,
          queue: true,
          notifications: true
        }
      };

      res.json(status);
    } catch (error) {
      this.logger.error('Error obteniendo estado:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async testConnections(req, res) {
    try {
      // OPTIMIZACIÓN: Usar cache de conexiones si es reciente
      const now = Date.now();
      if (this.connectionTestCache && 
          this.lastConnectionTest && 
          (now - this.lastConnectionTest) < this.CACHE_DURATION) {
        this.logger.debug('Usando cache de test de conexiones');
        return res.json(this.connectionTestCache);
      }

      const results = {
        timestamp: new Date().toISOString(),
        tests: {}
      };

      // Test MySQL - REUTILIZA LA CONEXIÓN EXISTENTE
      if (this.processor) {
        try {
          // IMPORTANTE: No crea nueva conexión, usa el pool existente
          const pool = this.processor.pool;
          await new Promise((resolve, reject) => {
            pool.query('SELECT 1', (err, results) => {
              if (err) reject(err);
              else resolve(results);
            });
          });
          
          results.tests.mysql = { 
            status: 'success', 
            message: 'Conexión exitosa (pool reutilizado)',
            poolConnections: pool._allConnections.length
          };
          this.logger.debug('MySQL test OK - Pool reutilizado');
        } catch (error) {
          results.tests.mysql = { status: 'error', message: error.message };
          this.logger.error('MySQL test failed:', error.message);
        }
      } else {
        results.tests.mysql = { status: 'disabled', message: 'MySQL no configurado' };
      }

      // Test ERP
      try {
        const axios = require('axios');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await axios.get(process.env.ERP_ENDPOINT + 'producto', {
          timeout: 10000,
          signal: controller.signal,
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        clearTimeout(timeout);

        results.tests.erp = {
          status: 'success',
          message: 'Endpoint accesible',
          statusCode: response.status
        };
        this.logger.debug('ERP test OK');
      } catch (error) {
        results.tests.erp = {
          status: 'error',
          message: error.code === 'ECONNABORTED' ? 'Timeout' : error.message,
          code: error.code
        };
        this.logger.error('ERP test failed:', error.message);
      }

      // Guardar en cache
      this.connectionTestCache = results;
      this.lastConnectionTest = now;

      res.json(results);
    } catch (error) {
      this.logger.error('Error probando conexiones:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getLastSync(req, res) {
    try {
      const lastSync = {
        timestamp: new Date().toISOString(),
        message: 'Información de última sincronización no disponible aún'
      };

      res.json(lastSync);
    } catch (error) {
      this.logger.error('Error obteniendo última sincronización:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = SystemController;
// public/js/dashboard-v2.js
let socket;
let currentPage = 1;
let currentFilters = { status: 'all', search: '' };

document.addEventListener('DOMContentLoaded', () => {
  initializeSocket();
  initializeEventListeners();
  loadInitialData();
  startAutoRefresh();
});

function initializeSocket() {
  socket = io();

  socket.on('connect', () => {
    updateConnectionStatus(true);
    addLog('success', 'Conectado al servidor');
  });

  socket.on('disconnect', () => {
    updateConnectionStatus(false);
    addLog('error', 'Desconectado del servidor');
  });

  socket.on('stats_update', (stats) => {
    updateStatsCards(stats);
  });

  socket.on('sync_progress', (progress) => {
    updateProgress(progress);
    addLog('info', `Procesando: ${progress.current} (${progress.processed}/${progress.processed + progress.pending})`);
  });

  socket.on('product_completed', (data) => {
    addLog('success', `✓ Producto completado: ${data.art_cod_int}`);
    refreshQueueTable();
  });

  socket.on('product_failed', (data) => {
    addLog('error', `✗ Error en producto: ${data.art_cod_int}`);
    refreshQueueTable();
  });

  socket.on('sync_started', (data) => {
    addLog('info', `🔄 Sincronización iniciada: Batch ${data.batch_id}`);
  });

  socket.on('sync_completed', (data) => {
    addLog('success', `✅ Sincronización completada: ${data.successful}/${data.total} exitosos`);
    refreshAllData();
  });
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connection-status');
  if (connected) {
    statusEl.innerHTML = '<span class="w-2 h-2 bg-green-400 rounded-full mr-2 pulse"></span>Conectado';
  } else {
    statusEl.innerHTML = '<span class="w-2 h-2 bg-red-400 rounded-full mr-2"></span>Desconectado';
  }
}

function initializeEventListeners() {
  document.getElementById('filter-status').addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    currentPage = 1;
    loadQueueData();
  });

  document.getElementById('search-sku').addEventListener('input', debounce((e) => {
    currentFilters.search = e.target.value;
    currentPage = 1;
    loadQueueData();
  }, 500));
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function loadInitialData() {
  await Promise.all([
    loadStats(),
    loadQueueData(),
    loadConfiguration(),
    testConnections()
  ]);
}

async function loadStats() {
  try {
    const response = await fetch('/api/queue/stats');
    const data = await response.json();
    updateStatsCards(data);
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function updateStatsCards(stats) {
  document.getElementById('stat-pending').textContent = stats.pending || 0;
  document.getElementById('stat-processing').textContent = stats.processing || 0;
  document.getElementById('stat-completed').textContent = stats.completed || 0;
  document.getElementById('stat-failed').textContent = stats.failed || 0;

  if (stats.processing > 0) {
    document.getElementById('processing-icon').classList.add('animate-spin');
  } else {
    document.getElementById('processing-icon').classList.remove('animate-spin');
  }
}

async function loadQueueData() {
  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 20,
      status: currentFilters.status,
      search: currentFilters.search
    });

    const response = await fetch(`/api/queue?${params}`);
    const result = await response.json();

    renderQueueTable(result.data);
    updatePagination(result.pagination);
  } catch (error) {
    console.error('Error loading queue:', error);
  }
}

function renderQueueTable(items) {
  const tbody = document.getElementById('queue-tbody');

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-8 text-center text-gray-500">
          No hay productos en la cola
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        ${escapeHtml(item.art_cod_int)}
      </td>
      <td class="px-6 py-4 text-sm text-gray-900">
        <div class="max-w-xs truncate">${escapeHtml(item.product_name || 'Sin nombre')}</div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <span class="status-badge status-${item.status}">
          ${getStatusLabel(item.status)}
        </span>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        ${item.attempts}/${item.max_attempts}
      </td>
      <td class="px-6 py-4 text-sm text-red-600">
        <div class="max-w-xs truncate" title="${escapeHtml(item.error_message || '')}">
          ${escapeHtml(item.error_message || '-')}
        </div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ${formatDate(item.updated_at)}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm">
        ${item.status === 'failed' ? `
          <button onclick="retrySingle('${escapeHtml(item.art_cod_int)}')"
                  class="text-orange-600 hover:text-orange-900 font-medium">
            Reintentar
          </button>
        ` : '-'}
      </td>
    </tr>
  `).join('');
}

function updatePagination(pagination) {
  const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);

  document.getElementById('showing-start').textContent = start;
  document.getElementById('showing-end').textContent = end;
  document.getElementById('showing-total').textContent = pagination.total;
}

async function loadConfiguration() {
  try {
    const response = await fetch('/api/system/config');
    const config = await response.json();

    document.getElementById('system-version').textContent = `v${config.version}`;

    const configPanel = document.getElementById('config-panel');
    configPanel.innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div class="col-span-2 bg-${config.sync.autoSyncEnabled ? 'green' : 'red'}-50 p-2 rounded">
          <p class="font-semibold text-${config.sync.autoSyncEnabled ? 'green' : 'red'}-800">Sincronización Automática</p>
          <p class="text-${config.sync.autoSyncEnabled ? 'green' : 'red'}-600">${config.sync.autoSyncEnabled ? 'HABILITADA' : 'DESHABILITADA'}</p>
          ${config.sync.autoSyncEnabled ? `<p class="text-xs text-green-600 mt-1">Cada ${config.sync.intervalMinutes} minutos</p>` : ''}
        </div>

        <div>
          <p class="text-gray-500">Intervalo</p>
          <p class="font-semibold">${config.sync.intervalMinutes} min</p>
        </div>
        <div>
          <p class="text-gray-500">Lote</p>
          <p class="font-semibold">${config.sync.batchSize} items</p>
        </div>
        <div>
          <p class="text-gray-500">Reintentos</p>
          <p class="font-semibold">${config.sync.maxRetries}</p>
        </div>
        <div>
          <p class="text-gray-500">Timeout</p>
          <p class="font-semibold">${config.sync.timeoutSeconds}s</p>
        </div>
      </div>
    `;

    if (config.sync.autoSyncEnabled) {
      document.getElementById('autosync-status').textContent = 'Activa';
      document.getElementById('autosync-status').className = 'text-lg font-bold text-green-600';

      const nextSync = new Date(Date.now() + config.sync.intervalMinutes * 60000);
      document.getElementById('autosync-next').textContent = `Próxima: ${nextSync.toLocaleTimeString('es-PY')}`;
    } else {
      document.getElementById('autosync-status').textContent = 'Deshabilitada';
      document.getElementById('autosync-status').className = 'text-lg font-bold text-red-600';
      document.getElementById('autosync-next').textContent = 'Configure AUTO_SYNC_ENABLED=true';
    }

    addLog('success', 'Configuración del sistema cargada');
  } catch (error) {
    addLog('error', `Error cargando configuración: ${error.message}`);
  }
}

async function testConnections() {
  try {
    const response = await fetch('/api/system/test-connections');
    const results = await response.json();

    if (results.tests.mysql.status === 'success') {
      document.getElementById('mysql-status').textContent = 'Conectado';
      document.getElementById('mysql-status').className = 'text-lg font-bold text-green-600';
      document.getElementById('mysql-host').textContent = 'Conectado y operativo';
      addLog('success', 'MySQL WooCommerce: Conexión establecida');
    } else if (results.tests.mysql.status === 'disabled') {
      document.getElementById('mysql-status').textContent = 'No configurado';
      document.getElementById('mysql-status').className = 'text-lg font-bold text-yellow-600';
      document.getElementById('mysql-host').textContent = 'Modo solo lectura';
      addLog('warning', 'MySQL WooCommerce: No configurado');
    } else {
      document.getElementById('mysql-status').textContent = 'Error';
      document.getElementById('mysql-status').className = 'text-lg font-bold text-red-600';
      document.getElementById('mysql-host').textContent = results.tests.mysql.message;
      addLog('error', `MySQL WooCommerce: ${results.tests.mysql.message}`);
    }

    if (results.tests.erp.status === 'success') {
      document.getElementById('erp-status').textContent = 'Accesible';
      document.getElementById('erp-status').className = 'text-lg font-bold text-green-600';
      document.getElementById('erp-endpoint').textContent = 'Endpoint accesible';
      addLog('success', 'API ERP: Endpoint accesible');
    } else {
      document.getElementById('erp-status').textContent = 'Error';
      document.getElementById('erp-status').className = 'text-lg font-bold text-red-600';
      document.getElementById('erp-endpoint').textContent = results.tests.erp.message;
      addLog('error', `API ERP: ${results.tests.erp.message}`);
    }
  } catch (error) {
    addLog('error', `Error probando conexiones: ${error.message}`);
  }
}

async function triggerSync() {
  if (!confirm('¿Iniciar nueva sincronización?')) return;

  try {
    const response = await fetch('/api/sync/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (result.success) {
      addLog('success', `Sincronización iniciada: Batch ${result.batch_id}`);
    } else {
      addLog('error', `Error al iniciar sincronización: ${result.error}`);
    }
  } catch (error) {
    addLog('error', 'Error al iniciar sincronización');
    console.error(error);
  }
}

async function retryAllFailed() {
  if (!confirm('¿Reintentar todos los productos fallidos?')) return;

  try {
    const response = await fetch('/api/queue/retry-failed', { method: 'POST' });
    const result = await response.json();
    addLog('success', `${result.count} productos marcados para reintento`);
    refreshQueueTable();
  } catch (error) {
    addLog('error', 'Error al reintentar productos');
    console.error(error);
  }
}

async function retrySingle(artCodInt) {
  try {
    const response = await fetch(`/api/queue/${artCodInt}/retry`, { method: 'POST' });
    const result = await response.json();
    addLog('success', `Producto ${artCodInt} marcado para reintento`);
    refreshQueueTable();
  } catch (error) {
    addLog('error', 'Error al reintentar producto');
    console.error(error);
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    loadQueueData();
  }
}

function nextPage() {
  currentPage++;
  loadQueueData();
}

function refreshQueueTable() {
  loadQueueData();
  loadStats();
}

function refreshAllData() {
  loadInitialData();
}

function startAutoRefresh() {
  setInterval(() => {
    loadStats();
    if (document.getElementById('filter-status').value !== 'completed') {
      refreshQueueTable();
    }
  }, 5000);
}

function updateProgress(progress) {
  if (progress.current) {
    addLog('info', `Procesando: ${progress.current}`);
  }
}

let logs = [];
const MAX_LOGS = 100;

function addLog(type, message) {
  const timestamp = new Date().toLocaleTimeString('es-PY', { hour12: false });
  const colors = {
    info: 'text-blue-600',
    success: 'text-green-600',
    error: 'text-red-600',
    warning: 'text-yellow-600'
  };

  logs.unshift({
    timestamp,
    type,
    message,
    color: colors[type] || 'text-gray-600'
  });

  if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);

  renderLogs();
}

function renderLogs() {
  const container = document.getElementById('live-logs');
  if (logs.length === 0) {
    container.innerHTML = '<div class="text-gray-400 text-center py-4">Esperando eventos...</div>';
    return;
  }

  container.innerHTML = logs.map(log => `
    <div class="log-entry ${log.color}">
      <span class="text-gray-400">[${log.timestamp}]</span>
      <span>${log.message}</span>
    </div>
  `).join('');
}

function clearLogs() {
  logs = [];
  renderLogs();
}

function getStatusLabel(status) {
  const labels = {
    pending: 'Pendiente',
    processing: 'Procesando',
    completed: 'Completado',
    failed: 'Fallido'
  };
  return labels[status] || status;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('es-PY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
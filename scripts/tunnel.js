/**
 * Túnel persistente - Melhora App Live
 * Mantém o localtunnel ativo 24/7
 */
const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');

const LOG_FILE = '/tmp/melhora-tunnel.log';
const PORT = 3000;
const SUBDOMAIN = 'melhora-app';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(msg);
}

async function startTunnel() {
  log('Iniciando túnel público...');
  
  try {
    const tunnel = await localtunnel({ 
      port: PORT, 
      subdomain: SUBDOMAIN 
    });
    
    log(`✅ URL PÚBLICA: ${tunnel.url}`);
    log('Túnel está ativo! Compartilhe este link.');
    
    // Save URL to a file for easy access
    fs.writeFileSync('/tmp/melhora-public-url.txt', tunnel.url);
    
    tunnel.on('close', () => {
      log('❌ Túnel fechado. Reiniciando em 5 segundos...');
      setTimeout(startTunnel, 5000);
    });
    
    tunnel.on('error', (err) => {
      log(`⚠️ Erro no túnel: ${err.message}. Reiniciando...`);
      setTimeout(startTunnel, 5000);
    });
    
  } catch (err) {
    log(`❌ Erro ao criar túnel: ${err.message}`);
    log('Tentando novamente em 10 segundos...');
    setTimeout(startTunnel, 10000);
  }
}

startTunnel();

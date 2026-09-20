// Loaded exclusively by demo.html. Never included in the game package.
window.AetheriusAdminDemo = {
  async send(message, receive) {
    try {
      const response = await fetch('/demo/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
      if (!response.ok) throw new Error('Demonstração indisponível.');
      receive(await response.json());
    } catch { receive({ version: 1, requestId: message.requestId, type: message.type, status: 'rejected', message: 'Servidor de demonstração indisponível.' }); }
  }
};

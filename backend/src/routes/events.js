const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { EventEmitter } = require('events');

const sseEmitter = new EventEmitter();

// We will export this emitter so other routes can push events
router.sseEmitter = sseEmitter;

router.get('/', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const onUpdate = () => {
    res.write(`data: ${JSON.stringify({ type: 'update' })}\n\n`);
  };

  sseEmitter.on('update', onUpdate);
  
  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    sseEmitter.off('update', onUpdate);
    clearInterval(keepAlive);
  });
});

module.exports = router;

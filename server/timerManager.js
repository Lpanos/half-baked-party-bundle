// Reusable countdown timer attached to a room. Emits `time_update` every
// second to both the host room (`code:host`) and every player socket.
// Clears any previous timer on the same room before starting.

function clearTimer(room) {
  if (!room) return;
  if (room._timerInterval) {
    clearInterval(room._timerInterval);
    room._timerInterval = null;
  }
  if (room._timerTimeout) {
    clearTimeout(room._timerTimeout);
    room._timerTimeout = null;
  }
}

function startTimer(room, io, seconds, onExpire) {
  clearTimer(room);
  let remaining = seconds;

  const broadcast = () => {
    io.to(room.code + ':host').emit('time_update', { secondsLeft: remaining });
    for (const p of room.players) {
      io.to(p.id).emit('time_update', { secondsLeft: remaining });
    }
  };

  broadcast();
  room._timerInterval = setInterval(() => {
    remaining--;
    if (remaining < 0) {
      clearTimer(room);
      try { onExpire && onExpire(); } catch (e) { console.error('timer onExpire error', e); }
      return;
    }
    broadcast();
  }, 1000);
}

// Pause without firing onExpire — used when game advances early (e.g., all
// players submitted before timer ran out).
function stopTimer(room) {
  clearTimer(room);
}

module.exports = { startTimer, stopTimer, clearTimer };

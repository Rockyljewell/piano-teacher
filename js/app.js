// Maestro: app entry point. Each UI module registers its screens and handlers on import.
import { show, app, coach, audio, stage, S } from './ui/core.js';
import './ui/listening.js';
import './ui/play.js';
import './ui/results.js';
import './ui/placement.js';
import './ui/songs.js';
import './ui/screens.js';
import './ui/listentest.js';

// Handy for debugging and the end-to-end tests.
window.__maestro = { coach, audio, stage, app, session: () => S.session, piece: () => S.piece, run: (act) => app.runActivity(act) };

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

show('home');

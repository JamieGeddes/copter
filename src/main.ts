import { Game } from './core/Game';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');
new Game(container).start();

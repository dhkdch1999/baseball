// 부트스트랩: 화면 등록 후 시작 화면 표시
import { registerView, navigate } from './ui/app.js';
import { startView } from './ui/views/start.js';
import { homeView } from './ui/views/home.js';
import { gameView } from './ui/views/game.js';
import { rosterView } from './ui/views/roster.js';
import { standingsView } from './ui/views/standings.js';
import { scheduleView } from './ui/views/schedule.js';
import { leadersView } from './ui/views/leaders.js';
import { tradeView } from './ui/views/trade.js';
import { faView } from './ui/views/fa.js';
import { offseasonView } from './ui/views/offseason.js';
import { savesView } from './ui/views/saves.js';

registerView('start', startView);
registerView('home', homeView);
registerView('game', gameView);
registerView('roster', rosterView);
registerView('standings', standingsView);
registerView('schedule', scheduleView);
registerView('leaders', leadersView);
registerView('trade', tradeView);
registerView('fa', faView);
registerView('offseason', offseasonView);
registerView('saves', savesView);

navigate('start');

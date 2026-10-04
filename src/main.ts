import { mount } from 'svelte';
// Manrope is bundled with the app (never fetched from a CDN: nothing leaves the device).
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/pdf-layers.css';
import './styles/pdf-annotation-layer.css';
import './editor/panels/panel.css';
import App from './App.svelte';
import { APP_NAME } from './config';

document.title = APP_NAME;

export default mount(App, { target: document.getElementById('app')! });

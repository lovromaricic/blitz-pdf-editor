import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/global.css';
import './styles/pdf-layers.css';
import App from './App.svelte';
import { APP_NAME } from './config';

document.title = APP_NAME;

export default mount(App, { target: document.getElementById('app')! });

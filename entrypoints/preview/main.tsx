import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Preview } from './preview';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><Preview /></StrictMode>,
);

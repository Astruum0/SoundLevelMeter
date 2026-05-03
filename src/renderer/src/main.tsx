import { render } from 'preact'

import { App } from './App'
import './styles.css'

const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('The renderer root element was not found.')
}

render(<App />, rootElement)


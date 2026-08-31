import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function runTui(props) {
  const instance = render(React.createElement(App, props), { exitOnCtrlC: true });
  await instance.waitUntilExit();
}

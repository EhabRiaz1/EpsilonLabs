"use client";

import { Icon } from "./Icon";
import { eps } from "./eps";

export function MenuButton() {
  return (
    <button className="btn btn-secondary btn-icon menu-btn" type="button" aria-label="Open menu" onClick={() => eps()?.open("sidebar")}>
      <Icon name="menu" />
    </button>
  );
}

export function CloseMenuButton() {
  return (
    <button
      className="btn btn-ghost btn-icon menu-btn"
      type="button"
      aria-label="Close menu"
      style={{ marginLeft: "auto" }}
      onClick={() => eps()?.close("sidebar")}
    >
      <Icon name="x" />
    </button>
  );
}

export function SearchButton({ label }: { label: string }) {
  return (
    <button className="sb-search cmdk-trigger" type="button" onClick={() => eps()?.cmdk.open()}>
      <Icon name="search" />
      {label}
      <span className="kbd">⌘K</span>
    </button>
  );
}

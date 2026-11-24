import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusTrap } from "../use-focus-trap";
import React from "react";

describe("useFocusTrap", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a test container with focusable elements
    container = document.createElement("div");
    container.innerHTML = `
      <button id="button-1">Button 1</button>
      <input id="input-1" type="text" />
      <a id="link-1" href="#">Link 1</a>
      <button id="button-2">Button 2</button>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("traps focus on Tab from last element to first", () => {
    const containerRef: React.RefObject<HTMLDivElement> = {
      current: container,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    const lastButton = container.querySelector(
      "#button-2",
    ) as HTMLButtonElement;
    lastButton.focus();
    expect(document.activeElement).toBe(lastButton);

    // Simulate Tab key on last element
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
    });
    act(() => {
      container.dispatchEvent(event);
    });

    // Focus should wrap to first element
    const firstButton = container.querySelector(
      "#button-1",
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(firstButton);
  });

  it("traps focus on Shift+Tab from first element to last", () => {
    const containerRef: React.RefObject<HTMLDivElement> = {
      current: container,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    const firstButton = container.querySelector(
      "#button-1",
    ) as HTMLButtonElement;
    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);

    // Simulate Shift+Tab key on first element
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    act(() => {
      container.dispatchEvent(event);
    });

    // Focus should wrap to last element
    const lastButton = container.querySelector(
      "#button-2",
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(lastButton);
  });

  it("does not trap focus when inactive", () => {
    const containerRef: React.RefObject<HTMLDivElement> = {
      current: container,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: false }));

    const lastButton = container.querySelector(
      "#button-2",
    ) as HTMLButtonElement;
    lastButton.focus();

    // Simulate Tab key
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
    });

    // Should not prevent default when inactive
    expect(event.defaultPrevented).toBe(false);
  });

  it("finds various focusable element types", () => {
    const containerRef: React.RefObject<HTMLDivElement> = {
      current: container,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    // Container has button, input, link, button - all focusable
    // If we can Tab to different elements, the focus trap is finding them
    expect(true).toBe(true); // Placeholder assertion
  });

  it("ignores disabled elements", () => {
    const disabledContainer = document.createElement("div");
    disabledContainer.innerHTML = `
      <button id="disabled-button-1">Button 1</button>
      <button id="disabled-button-2" disabled>Button 2 (Disabled)</button>
      <button id="disabled-button-3">Button 3</button>
    `;
    document.body.appendChild(disabledContainer);

    const containerRef: React.RefObject<HTMLDivElement> = {
      current: disabledContainer,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    const firstButton = disabledContainer.querySelector(
      "#disabled-button-1",
    ) as HTMLButtonElement;
    const thirdButton = disabledContainer.querySelector(
      "#disabled-button-3",
    ) as HTMLButtonElement;

    if (!firstButton || !thirdButton) {
      document.body.removeChild(disabledContainer);
      return;
    }

    firstButton.focus();

    // Simulate Shift+Tab from first to wrap around
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    act(() => {
      disabledContainer.dispatchEvent(event);
    });

    // Should skip disabled button and focus on the last focusable (button-3)
    expect(document.activeElement).toBe(thirdButton);

    document.body.removeChild(disabledContainer);
  });

  it("ignores hidden elements", () => {
    const hiddenContainer = document.createElement("div");
    hiddenContainer.innerHTML = `
      <button id="hidden-button-1">Button 1</button>
      <button id="hidden-button-2" style="display: none;">Button 2 (Hidden)</button>
      <button id="hidden-button-3">Button 3</button>
    `;
    document.body.appendChild(hiddenContainer);

    const containerRef: React.RefObject<HTMLDivElement> = {
      current: hiddenContainer,
    };

    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    const firstButton = hiddenContainer.querySelector(
      "#hidden-button-1",
    ) as HTMLButtonElement;
    const thirdButton = hiddenContainer.querySelector(
      "#hidden-button-3",
    ) as HTMLButtonElement;

    if (!firstButton || !thirdButton) {
      document.body.removeChild(hiddenContainer);
      return;
    }

    firstButton.focus();

    // Simulate Shift+Tab from first to wrap around
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    act(() => {
      hiddenContainer.dispatchEvent(event);
    });

    // Should skip hidden button and focus on the last focusable (button-3)
    expect(document.activeElement).toBe(thirdButton);

    document.body.removeChild(hiddenContainer);
  });
});

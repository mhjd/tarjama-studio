import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// Size all changed fields together. Alternating a height write and scrollHeight
// read for every caption forces thousands of document layouts on long projects.
const pending = new Set<HTMLTextAreaElement>();
let frame = 0;
function scheduleFit(input: HTMLTextAreaElement) {
  pending.add(input);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const inputs = [...pending].filter((element) => element.isConnected);
    pending.clear();
    // Keep the document tall while measuring. Otherwise collapsing all fields
    // can clamp scrollY and lose the reader's place near the end of a long page.
    const minHeight = document.body.style.minHeight;
    document.body.style.minHeight = `${document.documentElement.scrollHeight}px`;
    // Keep writes, reads and final writes in three separate passes.
    for (const element of inputs) element.style.height = "0px";
    const heights = inputs.map((element) => element.scrollHeight + 2);
    inputs.forEach((element, index) => {
      element.style.height = `${heights[index]}px`;
    });
    document.body.style.minHeight = minHeight;
  });
}

// Fit the text on every screen instead of leaving empty rows or hiding subtitles.
export function SubtitleInput({
  inputRef,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: (element: HTMLTextAreaElement | null) => void;
}) {
  const element = useRef<HTMLTextAreaElement | null>(null);
  function fit() {
    const input = element.current;
    if (input) scheduleFit(input);
  }
  useLayoutEffect(fit, [props.value]);
  useLayoutEffect(() => {
    const input = element.current;
    if (!input) return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fit();
      }
    });
    observer.observe(input);
    document.fonts.ready.then(() => {
      if (element.current) fit();
    });
    return () => {
      observer.disconnect();
      pending.delete(input);
      if (!pending.size && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }, []);
  return (
    <textarea
      {...props}
      ref={(input) => {
        element.current = input;
        inputRef(input);
      }}
    />
  );
}

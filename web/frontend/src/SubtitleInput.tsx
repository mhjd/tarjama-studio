import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// Expand mobile text instead of leaving empty rows or hiding long subtitles.
export function SubtitleInput({
  inputRef,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: (element: HTMLTextAreaElement | null) => void;
}) {
  const element = useRef<HTMLTextAreaElement | null>(null);
  function fit() {
    const input = element.current;
    if (!input) return;
    if (window.matchMedia("(max-width: 640px)").matches) {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight + 2}px`;
    } else {
      input.style.removeProperty("height");
    }
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
    const query = window.matchMedia("(max-width: 640px)");
    query.addEventListener("change", fit);
    document.fonts.ready.then(() => {
      if (element.current) fit();
    });
    return () => {
      observer.disconnect();
      query.removeEventListener("change", fit);
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

import React, { useEffect, useRef, useState } from 'react';

const INTERACTIVE_SELECTOR = '[data-help],button,a,[role="button"],input,select,textarea';

const normalizeText = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').replace(/[：:]\s*$/, '').trim();
};

const shorten = (value: string, max = 56) => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
};

const getFieldLabelText = (element: HTMLElement) => {
  const scope = element.closest('.space-y-3') as HTMLElement | null;
  if (!scope) return '';
  const label = scope.querySelector('label');
  return normalizeText(label?.textContent);
};

const getHintText = (element: HTMLElement) => {
  const dataHelp = normalizeText(element.getAttribute('data-help'));
  if (dataHelp) return dataHelp;

  const title = normalizeText(element.getAttribute('title'));
  if (title) return title;

  const ariaLabel = normalizeText(element.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const labelText = getFieldLabelText(element);
    if (labelText) return `用于填写或调整：${shorten(labelText, 42)}`;

    const placeholder = normalizeText('placeholder' in element ? element.placeholder : '');
    if (placeholder) return `请输入：${shorten(placeholder, 42)}`;

    return '用于输入或调整当前参数';
  }

  const isButtonLike = element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || element.getAttribute('role') === 'button';
  if (isButtonLike) {
    const contentText = normalizeText(element.textContent);
    if (contentText) return `点击执行：${shorten(contentText, 42)}`;
    return '点击执行当前操作';
  }

  return '';
};

interface HoverHelpOverlayProps {
  disabled?: boolean;
}

export const HoverHelpOverlay: React.FC<HoverHelpOverlayProps> = ({ disabled = false }) => {
  const [hint, setHint] = useState('');
  const [visible, setVisible] = useState(false);
  const currentElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!disabled) return;
    currentElementRef.current = null;
    setVisible(false);
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;

    const updateHint = (target: EventTarget | null) => {
      const element = (target as HTMLElement | null)?.closest?.(INTERACTIVE_SELECTOR) as HTMLElement | null;

      if (!element) {
        currentElementRef.current = null;
        setVisible(false);
        return;
      }

      if (currentElementRef.current === element) return;

      currentElementRef.current = element;
      const nextHint = getHintText(element);
      if (!nextHint) {
        setVisible(false);
        return;
      }

      setHint(nextHint);
      setVisible(true);
    };

    const hideHint = () => {
      currentElementRef.current = null;
      setVisible(false);
    };

    const onMouseMove = (event: MouseEvent) => updateHint(event.target);
    const onFocusIn = (event: FocusEvent) => updateHint(event.target);

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('blur', hideHint);
    document.addEventListener('mouseleave', hideHint as EventListener);

    return () => {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('blur', hideHint);
      document.removeEventListener('mouseleave', hideHint as EventListener);
    };
  }, [disabled]);

  return (
    <div
      className={`fixed right-6 bottom-6 z-[120] max-w-md rounded-2xl px-4 py-3 text-[12px] font-semibold leading-relaxed text-white shadow-xl backdrop-blur-sm pointer-events-none transition-all duration-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      style={{ backgroundColor: 'rgba(71, 85, 105, 0.62)' }}
      aria-live="polite"
      aria-hidden={!visible}
    >
      {hint || '功能说明'}
    </div>
  );
};

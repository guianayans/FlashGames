import { useCallback, useEffect, useRef, useState } from "react";

export interface FitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Callback ref + ResizeObserver: mede o retangulo (coordenadas de viewport,
 * tipo getBoundingClientRect) do elemento "slot" que essa ref for anexada, e
 * devolve o maior retangulo com a proporcao `ratio` (largura/altura) que
 * cabe dentro dele sem esticar, centralizado — usado pra encaixar o jogo
 * (proporcao original do .swf) dentro de uma janela de tamanho independente
 * (o slot da tela no shell, ou a tela cheia no modo paisagem).
 *
 * E uma callback ref (nao um RefObject fixo) de proposito: o elemento "slot"
 * entra e sai do DOM quando o app troca de modo (retrato/paisagem/desktop),
 * e a callback ref avisa exatamente quando isso acontece pra (re)conectar o
 * ResizeObserver no elemento certo.
 *
 * O retorno usa coordenadas de viewport de proposito: o elemento que recebe
 * esse retangulo fica posicionado com `position: fixed`, que usa o mesmo
 * sistema de coordenadas.
 */
export function useContainFit(ratio: number): [FitRect | null, (el: HTMLElement | null) => void] {
  const [rect, setRect] = useState<FitRect | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const compute = useCallback(() => {
    const el = elRef.current;
    if (!el || !ratio) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const slotRatio = r.width / r.height;
    let w: number;
    let h: number;
    if (ratio > slotRatio) {
      w = r.width;
      h = r.width / ratio;
    } else {
      h = r.height;
      w = r.height * ratio;
    }
    setRect({
      left: r.left + (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      width: w,
      height: h,
    });
  }, [ratio]);

  const setEl = useCallback(
    (el: HTMLElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      elRef.current = el;
      if (el) {
        const ro = new ResizeObserver(compute);
        ro.observe(el);
        roRef.current = ro;
        compute();
      } else {
        setRect(null);
      }
    },
    [compute]
  );

  useEffect(() => {
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [compute]);

  return [rect, setEl];
}

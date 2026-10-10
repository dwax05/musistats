import { memo, useEffect, useRef } from "react";

type Dot = { x: number; y: number; currentX: number; currentY: number };

const DotField = memo(function DotField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const canvasContext = canvasElement.getContext("2d");
    if (!canvasContext) return;
    const canvas = canvasElement;
    const context = canvasContext;

    const pointer = { x: -1000, y: -1000 };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let frame = 0;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      dots = [];
      for (let y = 16; y < window.innerHeight; y += 24) {
        for (let x = 16; x < window.innerWidth; x += 24) {
          dots.push({ x, y, currentX: x, currentY: y });
        }
      }
      if (reducedMotion) draw();
    }

    function draw() {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      context.fillStyle = "rgba(119, 140, 131, 0.24)";
      context.beginPath();

      for (const dot of dots) {
        const dx = dot.x - pointer.x;
        const dy = dot.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        const force = distance < 150 ? (1 - distance / 150) * 22 : 0;
        const targetX = distance ? dot.x + (dx / distance) * force : dot.x;
        const targetY = distance ? dot.y + (dy / distance) * force : dot.y;
        dot.currentX += (targetX - dot.currentX) * 0.1;
        dot.currentY += (targetY - dot.currentY) * 0.1;
        context.moveTo(dot.currentX + 1, dot.currentY);
        context.arc(dot.currentX, dot.currentY, 1, 0, Math.PI * 2);
      }

      context.fill();
      if (!reducedMotion) frame = requestAnimationFrame(draw);
    }

    function move(event: PointerEvent) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }

    function leave() {
      pointer.x = -1000;
      pointer.y = -1000;
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    resize();
    if (!reducedMotion) draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10" aria-hidden="true" />;
});

export default DotField;

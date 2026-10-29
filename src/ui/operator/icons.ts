// Map icons drawn on a canvas at 2x (no image assets): quadcopter, fixed-wing, officer badge.

type Icon = { width: number; height: number; data: Uint8ClampedArray };

function draw(size: number, paint: (c: CanvasRenderingContext2D, s: number) => void): Icon {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  paint(c, size);
  return { width: size, height: size, data: c.getImageData(0, 0, size, size).data };
}

/** Top-down quadcopter pointing up (north); the map rotates it to its heading. */
export const quadIcon = () =>
  draw(72, (c, s) => {
    const m = s / 2;
    const arm = s * 0.3;
    c.lineCap = "round";
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(m - arm, m - arm);
    c.lineTo(m + arm, m + arm);
    c.moveTo(m + arm, m - arm);
    c.lineTo(m - arm, m + arm);
    c.stroke();
    c.strokeStyle = "#ffffff";
    c.lineWidth = 5;
    c.stroke();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.beginPath();
      c.arc(m + dx * arm, m + dy * arm, s * 0.13, 0, Math.PI * 2);
      c.fillStyle = "rgba(255,255,255,0.28)";
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = "#ffffff";
      c.stroke();
    }
    c.beginPath();
    c.arc(m, m, s * 0.12, 0, Math.PI * 2);
    c.fillStyle = "#3987e5";
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "#ffffff";
    c.stroke();
    // Nose marker so the heading reads at a glance.
    c.beginPath();
    c.moveTo(m, m - s * 0.26);
    c.lineTo(m - s * 0.07, m - s * 0.14);
    c.lineTo(m + s * 0.07, m - s * 0.14);
    c.closePath();
    c.fillStyle = "#fab219";
    c.fill();
  });

/** Top-down fixed-wing aircraft pointing up. */
export const planeIcon = () =>
  draw(72, (c, s) => {
    const m = s / 2;
    const path = () => {
      c.beginPath();
      c.moveTo(m, s * 0.08); // nose
      c.lineTo(m + s * 0.05, s * 0.36);
      c.lineTo(m + s * 0.44, s * 0.48); // right wing tip
      c.lineTo(m + s * 0.44, s * 0.55);
      c.lineTo(m + s * 0.05, s * 0.52);
      c.lineTo(m + s * 0.04, s * 0.78);
      c.lineTo(m + s * 0.17, s * 0.86); // tail
      c.lineTo(m + s * 0.17, s * 0.91);
      c.lineTo(m, s * 0.88);
      c.lineTo(m - s * 0.17, s * 0.91);
      c.lineTo(m - s * 0.17, s * 0.86);
      c.lineTo(m - s * 0.04, s * 0.78);
      c.lineTo(m - s * 0.05, s * 0.52);
      c.lineTo(m - s * 0.44, s * 0.55);
      c.lineTo(m - s * 0.44, s * 0.48);
      c.lineTo(m - s * 0.05, s * 0.36);
      c.closePath();
    };
    path();
    c.lineWidth = 6;
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.stroke();
    path();
    c.fillStyle = "#ffffff";
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#3987e5";
    c.stroke();
  });

/** Small police badge shown at a scene once the officer is there. */
export const officerIcon = () =>
  draw(44, (c, s) => {
    const m = s / 2;
    c.beginPath();
    c.arc(m, m, s * 0.42, 0, Math.PI * 2);
    c.fillStyle = "#1c3f7a";
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "#ffffff";
    c.stroke();
    // Five-point star.
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s * 0.24 : s * 0.1;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      c.lineTo(m + r * Math.cos(a), m + r * Math.sin(a));
    }
    c.closePath();
    c.fillStyle = "#fab219";
    c.fill();
  });

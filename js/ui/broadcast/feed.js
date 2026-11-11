// 문자중계 피드: 한 줄씩 아래로 쌓고 자동 스크롤
export class Feed {
  constructor(el) {
    this.el = el;
  }
  clear() { this.el.innerHTML = ''; }

  /** @param lines [{text, cls, meta}] */
  push(lines, { animate = true } = {}) {
    if (!lines.length) return;
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      const div = document.createElement('div');
      div.className = `ln ${l.cls}`;
      if (!animate) div.style.animation = 'none';
      div.textContent = l.text;
      if (l.meta) {
        const m = document.createElement('span');
        m.className = 'meta';
        m.textContent = l.meta;
        div.appendChild(m);
      }
      frag.appendChild(div);
    }
    this.el.appendChild(frag);
  }

  scrollToEnd() {
    this.el.scrollTop = this.el.scrollHeight;
  }
}

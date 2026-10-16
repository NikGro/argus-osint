/** Reserve exactly the space that running tasks need, and distribute whole groups per row. */
export function setupWorkspaceLayout() {
  const toolbar = document.querySelector('#workspace > .toolbar');
  const groups = [...toolbar.querySelectorAll(':scope > .toolbar-group')].sort(
    (a, b) =>
      Number(a.classList.contains('activity-tools')) -
      Number(b.classList.contains('activity-tools'))
  );
  toolbar.querySelectorAll(':scope > .divider').forEach((node) => node.remove());
  let scheduled = false;
  let signature = '';
  function layout() {
    scheduled = false;
    if (!toolbar.getClientRects().length) return;
    const style = getComputedStyle(toolbar);
    const available =
      toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const sectionGap = parseFloat(style.getPropertyValue('--toolbar-button-gap')) * 4 + 1;
    const widths = groups.map((group) => {
      const style = getComputedStyle(group);
      const children = [...group.children].filter(
        (child) => getComputedStyle(child).display !== 'none'
      );
      return Math.ceil(
        children.reduce((sum, child) => {
          const css = getComputedStyle(child);
          return (
            sum +
            child.getBoundingClientRect().width +
            (parseFloat(css.marginLeft) || 0) +
            (parseFloat(css.marginRight) || 0)
          );
        }, 0) +
          Math.max(0, children.length - 1) * (parseFloat(style.columnGap) || 0)
      );
    });
    const rows = [[]];
    let used = 0;
    groups.forEach((group, index) => {
      const width = widths[index];
      if (used && used + sectionGap + width > available) {
        rows.push([]);
        used = 0;
      }
      rows.at(-1).push(group);
      used += (used ? sectionGap : 0) + width;
    });
    const next = rows.map((row) => row.map((group) => groups.indexOf(group)).join(',')).join('|');
    if (next !== signature) {
      signature = next;
      const fragment = document.createDocumentFragment();
      for (const row of rows) {
        const wrapper = document.createElement('div');
        wrapper.className = 'toolbar-row';
        wrapper.append(...row);
        fragment.append(wrapper);
      }
      toolbar.replaceChildren(fragment);
    }
  }
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(layout);
    }
  };
  new ResizeObserver(schedule).observe(toolbar);
  new MutationObserver(schedule).observe(document.getElementById('actorActivity'), {
    childList: true,
    subtree: true,
    characterData: true
  });
  document.addEventListener('argus:language', schedule);
  document.fonts?.ready.then(schedule);
  toolbar.addEventListener('click', (event) => {
    const selected = event.target.closest('details');
    for (const menu of toolbar.querySelectorAll('details[open]'))
      if (menu !== selected || event.target.closest('button')) menu.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    for (const menu of toolbar.querySelectorAll('details[open]'))
      if (!menu.contains(event.target)) menu.open = false;
  });
  toolbar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape')
      for (const menu of toolbar.querySelectorAll('details[open]')) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
  });
  const body = document.querySelector('.workbody');
  const palette = document.getElementById('palette');
  const inspector = document.getElementById('inspector');
  function positionTabs() {
    const origin = body.getBoundingClientRect();
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    const left = palette.hidden ? canvas.left : palette.getBoundingClientRect().right;
    const right = inspector.hidden ? canvas.right : inspector.getBoundingClientRect().left;
    body.style.setProperty('--left-panel-edge', `${left - origin.left}px`);
    body.style.setProperty('--right-panel-edge', `${right - origin.left}px`);
  }
  const panels = new ResizeObserver(positionTabs);
  for (const panel of [body, palette, inspector]) panels.observe(panel);
  schedule();
}

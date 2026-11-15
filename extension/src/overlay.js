(function (root) {
  'use strict';
  const badges = new Map();
  const note = {
    lead: 'The % is how often this train reached your stop 20+ min late on past runs.',
    rules: ['20+ min late: your saver ticket is no longer tied to this train. Take any train.', '60+ min late: 25 % of the fare back. 120+ min: 50 %.'],
    fine: "The count is raw runs on the same weekday; with few runs Kurt blends in other weekdays, so the % can differ. Kurt's pick is the likeliest late train (30 % or more) with another train on this page to switch to. A delay bahn.de already shows does not count.",
  };
  const snail = '<svg width="24" height="18" viewBox="0 0 80 60" aria-hidden="true"><rect x="4" y="44" width="68" height="10" rx="5" fill="white"/><path d="M11 46 C9 37 11 29 17 25" stroke="white" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M16 25 L10 11 M19 25 L23 10" stroke="white" stroke-width="2.5"/><circle cx="10" cy="10" r="3.2" fill="white"/><circle cx="23" cy="9" r="3.2" fill="white"/><circle cx="47" cy="27" r="19" fill="#FD4F00" stroke="white" stroke-width="2.5"/><path d="M44 27 a3 3 0 1 1 6 0 a6 6 0 1 1 -12 0 a9 9 0 1 1 18 0 a12 12 0 1 1 -24 0" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
  function text(result, card) {
    const kurt = result.kurt === true && !card?.posted;
    let line = result.basis === 'none' || !Number.isFinite(result.p20)
      ? (card?.trains?.length && root.SpkParse && !root.SpkParse.isLongDistance(card.trains.at(-1)) ? 'No odds: last leg is a regional train' : 'No history for this train yet')
      : result.basis === 'estimate'
        ? `${Math.round(result.p20 * 100)} % 20+ late, counting a missed change (${result.train} alone: ${result.late} of ${result.n} ${result.weekday}s)`
        : `${Math.round(result.p20 * 100)} % ${result.basis === 'last_train' ? 'last train ' : ''}20+ late (${result.late} of ${result.n} ${result.weekday}s)`;
    if (card?.posted) line = 'Delay already posted: won’t count · ' + line;
    if (kurt) line = 'Kurt: ' + line;
    return { line, kurt };
  }
  function render(card, result, { link, server }) {
    const description = text(result, card);
    const signature = JSON.stringify([description, link, server]);
    const previous = badges.get(card.el);
    for (const badge of card.el.querySelectorAll('spk-badge')) {
      if (badge !== previous?.host) badge.remove();
    }
    if (previous?.signature === signature && previous.core === card.core && previous.host.isConnected) return previous.host;
    previous?.host.remove();
    const doc = card.el.ownerDocument;
    const host = doc.createElement('spk-badge');
    host.setAttribute('aria-label', description.line);
    host.dataset.kurt = String(description.kurt);
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = ':host{display:block;margin:6px 0;max-width:100%;font:12px/1.45 system-ui,sans-serif;color:#C93D00}*{box-sizing:border-box}.pill{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:100%;padding:4px 8px;border:1px solid #FD4F00;border-radius:14px;background:white}.kurt{background:#FD4F00;color:white}button,a{font:inherit;color:inherit}button{border:1px solid currentColor;border-radius:50%;background:transparent;cursor:pointer;min-width:22px;min-height:22px;padding:0 5px}a{white-space:nowrap}.note{max-width:380px;background:white;color:#14161A;border:1px solid #FD4F00;border-radius:8px;padding:8px;margin-top:4px}.note p,.note ul{margin:0}.note ul{padding-left:16px;margin:4px 0}.lead{font-weight:600}.fine{color:#5B616B;font-size:11px}svg{flex-shrink:0}';
    shadow.append(style);
    const pill = doc.createElement('span');
    pill.className = 'pill' + (description.kurt ? ' kurt' : '');
    if (description.kurt) {
      const icon = doc.createElement('span');
      icon.innerHTML = snail;
      pill.append(icon);
    }
    const label = doc.createElement('span');
    label.textContent = description.line;
    pill.append(label);
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.textContent = '?';
    toggle.setAttribute('aria-label', 'About these odds');
    toggle.setAttribute('aria-expanded', 'false');
    const help = doc.createElement('div');
    help.className = 'note';
    help.hidden = true;
    const lead = doc.createElement('p');
    lead.className = 'lead';
    lead.textContent = note.lead;
    const rules = doc.createElement('ul');
    for (const rule of note.rules) {
      const item = doc.createElement('li');
      item.textContent = rule;
      rules.append(item);
    }
    const fine = doc.createElement('p');
    fine.className = 'fine';
    fine.textContent = note.fine;
    help.append(lead, rules, fine);
    toggle.addEventListener('click', () => {
      help.hidden = !help.hidden;
      toggle.setAttribute('aria-expanded', String(!help.hidden));
    });
    pill.append(toggle);
    if (description.kurt && typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')) {
      const anchor = doc.createElement('a');
      anchor.href = server + link;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = 'Open in Kurt';
      pill.append(anchor);
    }
    shadow.append(pill, help);
    for (const event of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress']) {
      host.addEventListener(event, e => e.stopPropagation());
    }
    const interactive = card.core.closest('a,button,[role="button"],summary,label');
    if (interactive) interactive.after(host);
    else card.core.append(host);
    badges.set(card.el, { host, signature, core: card.core });
    return host;
  }
  function clear(root) {
    for (const [card, { host }] of badges) {
      if (root === card || root.contains(card) || !card.isConnected) {
        host.remove();
        badges.delete(card);
      }
    }
  }
  root.SpkOverlay = { text, render, clear };
  if (typeof module !== 'undefined') module.exports = root.SpkOverlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);

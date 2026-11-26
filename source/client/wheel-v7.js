(function () {
  'use strict';

  const colors = ['#f8ccb3', '#c9e3e6', '#dbe6bd', '#fbe5aa', '#e3cbd7', '#cddfcf'];
  const initialChoices = ['看电影', '逛书店', '打球', '散步'];

  function randomIndex(count) {
    const limit = 0x100000000 - (0x100000000 % count);
    const sample = new Uint32Array(1);
    do { window.crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % count;
  }

  function nextAngle(angle, index, count) {
    const target = 360 - (index + 0.5) * 360 / count;
    return angle + 4 * 360 + (target - angle % 360 + 360) % 360;
  }

  function sectorColor(index, count) {
    // With an odd number of sectors the last slice still needs a distinct neighbour.
    return index && index === count - 1 && index % colors.length === 0
      ? colors[1] : colors[index % colors.length];
  }

  window.LycheeWheelV7 = function LycheeWheelV7({ React }) {
    const h = React.createElement;
    const [topic, setTopic] = React.useState('周末做什么？');
    const [rows, setRows] = React.useState(() => initialChoices.map((label, id) => ({ id, label })));
    const [angle, setAngle] = React.useState(0);
    const [result, setResult] = React.useState(null);
    const [spinning, setSpinning] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [diameter, setDiameter] = React.useState(240);
    const disc = React.useRef(null);
    const frame = React.useRef(null);
    const animation = React.useRef(null);
    const nextId = React.useRef(initialChoices.length);
    const focusNewRow = React.useRef(null);
    const choices = rows.filter(row => row.label.trim());
    const count = choices.length;
    const positions = new Map(choices.map((row, index) => [row.id, index]));

    React.useEffect(() => {
      const measure = () => { if (disc.current) setDiameter(disc.current.clientWidth); };
      measure();
      const observer = window.ResizeObserver ? new ResizeObserver(measure) : null;
      if (observer) observer.observe(frame.current);
      else window.addEventListener('resize', measure);
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', measure);
        animation.current?.cancel();
      };
    }, []);

    function editRows(updated) {
      setRows(updated);
      setAngle(0);
      setResult(null);
    }

    function addRow() {
      const id = nextId.current++;
      focusNewRow.current = id;
      setExpanded(true);
      editRows([...rows, { id, label: '' }]);
    }

    function spin() {
      if (animation.current || spinning || count < 2) return;
      const index = randomIndex(count);
      const target = nextAngle(angle, index, count);
      const transform = value => 'rotate(' + value + 'deg)';
      const announce = () => {
        setResult({ id: choices[index].id, label: choices[index].label.trim(), index });
        setSpinning(false);
      };
      setResult(null);
      setAngle(target);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !disc.current.animate) {
        announce();
        return;
      }
      setSpinning(true);
      const turn = disc.current.animate([{ transform: transform(angle) }, { transform: transform(target) }], {
        duration: 2850, easing: 'cubic-bezier(.14,.65,.15,1)'
      });
      animation.current = turn;
      turn.onfinish = () => {
        animation.current = null;
        announce();
      };
    }

    const step = 360 / count;
    const seam = Math.min(90 / diameter, step * .09);
    const segments = choices.map((_, index) => {
      const start = index * step, end = (index + 1) * step;
      return '#c4a375 ' + start + 'deg ' + (start + seam) + 'deg, ' +
        sectorColor(index, count) + ' ' + (start + seam) + 'deg ' + end + 'deg';
    });
    const fontSize = Math.min(29, Math.max(16, diameter * .083));
    const room = count < 2 ? diameter * .42 : diameter * .62 * Math.sin(Math.PI / count);
    const numbered = count > 8 || room < fontSize * 2.35;
    const numberSize = Math.min(15, Math.max(11, diameter * .056));
    const stride = numbered ? Math.max(1, Math.ceil((String(count).length * numberSize * .62 + 4) / room)) : 1;
    const labelOffset = result?.index ?? 0;
    const labels = choices.map((row, index) => {
      const distance = (index - labelOffset + count) % count;
      if (distance % stride || (distance && count - distance < stride)) return null;
      const radians = (index + 0.5) * 2 * Math.PI / count;
      const radius = count === 1 ? 28 : 31;
      return h('span', {
        key: row.id, className: 'v7-wheel-label',
        style: { left: 50 + radius * Math.sin(radians) + '%', top: 50 - radius * Math.cos(radians) + '%',
          fontSize: numbered ? numberSize : Math.min(fontSize, room / 2.8),
          maxWidth: numbered ? undefined : Math.min(room * .94, diameter * .42) }
      }, numbered ? index + 1 : row.label.trim());
    });

    return h('section', { className: 'v7-wheel', 'aria-label': '交给命运' },
      h('img', { className: 'v7-wheel-banner', src: '/client/wheel-banner-v7.webp', alt: '' }),
      h('label', { className: 'v7-wheel-topic' },
        h('input', { type: 'text', value: topic, disabled: spinning, 'aria-label': '转盘主题', placeholder: '想决定什么？',
          onChange: event => { setTopic(event.target.value); setResult(null); } }),
        h('span', { 'aria-hidden': true }, '✎')),
      h('div', { className: 'v7-wheel-stage' },
        h('div', { className: 'v7-wheel-frame', ref: frame },
          h('div', { className: 'v7-wheel-pointer', 'aria-hidden': true }),
          h('div', {
            ref: disc, className: 'v7-wheel-disc', 'aria-hidden': true,
            style: { transform: 'rotate(' + angle + 'deg)', '--ink-turn': (spinning ? 0 : -angle % 360) + 'deg', background: segments.length > 1
              ? 'conic-gradient(' + segments.join(', ') + ')' : (segments.length ? colors[0] : '#e8dfc9') }
          }, labels),
          h('span', { className: 'v7-wheel-hub', 'aria-hidden': true })),
        h('button', { type: 'button', className: 'v7-wheel-spin', disabled: spinning || count < 2, onClick: spin },
          spinning ? '转动中…' : (result ? '再转一次' : '开始转动')),
        h('p', { role: 'status', className: 'v7-wheel-result' }, result ? '选中了' +
          (choices.some(row => row.id !== result.id && row.label.trim() === result.label) || numbered ? '第 ' + (result.index + 1) + ' 项' : '') +
          '「' + result.label + '」' :
          (count < 2 ? '填入至少两个选项' : ''))),
      h('div', { className: 'v7-wheel-editor' },
        h('div', { className: 'v7-wheel-editor-bar' },
          h('button', { type: 'button', className: 'v7-wheel-list-toggle', 'aria-expanded': expanded,
            onClick: () => setExpanded(!expanded) }, '我的选项'),
          h('button', { type: 'button', disabled: spinning, className: 'v7-wheel-add', onClick: addRow }, '＋ 添加选项')),
        h('ol', { hidden: !expanded, 'aria-label': '编辑转盘选项' }, rows.map((row, index) => {
          const optionIndex = positions.get(row.id) ?? -1;
          return h('li', { key: row.id, 'aria-current': result?.id === row.id ? 'true' : undefined },
            h('span', { className: 'v7-wheel-key', 'aria-hidden': true,
              style: { background: optionIndex < 0 ? '#e8dfc9' : sectorColor(optionIndex, count) } },
              optionIndex < 0 ? '·' : optionIndex + 1),
            h('input', {
              'aria-label': '选项 ' + (index + 1), type: 'text', value: row.label, disabled: spinning,
              ref: input => {
                if (input && focusNewRow.current === row.id) { focusNewRow.current = null; input.focus(); }
              },
              onChange: event => editRows(rows.map(item => item.id === row.id ? { ...item, label: event.target.value } : item)),
              placeholder: '填一个选项'
            }),
            h('button', { type: 'button', disabled: spinning, 'aria-label': '删除选项 ' + (index + 1),
              onClick: () => editRows(rows.filter(item => item.id !== row.id)) }, '×'));
        }))));
  };
})();

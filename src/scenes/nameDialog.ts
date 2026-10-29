import { NAME_MAX, randomName } from '../core/economy';

/**
 * The 修改道号 box: an HTML dialog over the game, since only a real input field brings up the phone's keyboard
 * and IME. Styled after the hall kit (navy lacquer, gold rim). `check` validates and applies the name, returning
 * an error to show, or null to close. When the game is turned sideways in a portrait window (rotateHint), the
 * box turns with it.
 */
export function askName(current: string, check: (name: string) => string | null, onClose: () => void) {
  if (document.getElementById('ih-name')) return;
  // single quotes: the font list also goes inside style="…" attributes below
  const gold = '#ffd868', font = "'PingFang SC','Microsoft YaHei',sans-serif";
  const root = document.createElement('div');
  root.id = 'ih-name';
  root.style.cssText = 'position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(5,8,20,0.72)';
  const box = document.createElement('div');
  box.style.cssText = `width:min(340px,86vmax);padding:20px 22px 18px;border-radius:16px;font-family:${font};color:#fff4dc;` +
    `background:linear-gradient(#232b52,#121836);border:2px solid ${gold};box-shadow:0 0 0 4px rgba(185,138,44,0.35),0 12px 30px rgba(0,0,0,0.5)`;
  if (innerHeight > innerWidth * 1.1) box.style.transform = 'rotate(90deg)';
  box.innerHTML =
    `<div style="text-align:center;font-size:20px;font-weight:700;color:${gold};letter-spacing:2px;text-shadow:0 2px 0 #2a1608">修改道号</div>` +
    `<div style="display:flex;gap:8px;margin-top:16px"><input id="ih-name-in" maxlength="${NAME_MAX * 2}" autocomplete="off" enterkeyhint="done" ` +
    `style="flex:1;min-width:0;box-sizing:border-box;height:42px;padding:0 12px;font:16px ${font};color:#fff;background:#0b1127;` +
    `border:1.5px solid ${gold};border-radius:10px;outline:none" />` +
    `<button data-k="dice" style="width:64px">随机</button></div>` +
    `<div id="ih-name-tip" style="min-height:18px;margin-top:8px;font-size:12px;color:#b9c0dc">最多 ${NAME_MAX} 个字</div>` +
    `<div style="display:flex;gap:12px;margin-top:10px"><button data-k="cancel" style="flex:1">取消</button><button data-k="ok" style="flex:1">确定</button></div>`;
  const skin: Record<string, string> = { dice: '#2f9e8f', cancel: '#2c3a6e', ok: '#d8a032' };
  box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.style.cssText += `;height:42px;font:600 16px ${font};color:#fff;border-radius:21px;cursor:pointer;` +
      `background:${skin[b.dataset.k!]};border:2px solid ${gold};text-shadow:0 1px 0 rgba(0,0,0,0.5)`;
  });
  root.appendChild(box);
  document.body.appendChild(root);
  const input = box.querySelector<HTMLInputElement>('#ih-name-in')!, tip = box.querySelector<HTMLDivElement>('#ih-name-tip')!;
  input.value = current;
  const close = () => { root.remove(); onClose(); };
  const submit = () => {
    const err = check(input.value);
    if (!err) { close(); return; }
    tip.textContent = err;
    tip.style.color = '#ff8a7a';
  };
  box.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset?.k;
    if (k === 'ok') submit();
    else if (k === 'cancel') close();
    else if (k === 'dice') { input.value = randomName(); input.focus(); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); }); // tap outside: cancel
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('input', () => { tip.textContent = `最多 ${NAME_MAX} 个字`; tip.style.color = '#b9c0dc'; });
  input.focus();
  input.select();
}

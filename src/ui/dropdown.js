const chevronIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const checkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createDropdown(select) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dd';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dd-btn';
  button.setAttribute('aria-haspopup', 'listbox');

  const list = document.createElement('ul');
  list.className = 'dd-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  select.hidden = true;
  select.after(wrapper);
  wrapper.append(button, list, select);

  const close = () => {
    list.hidden = true;
    wrapper.classList.remove('open');
  };

  const render = () => {
    button.innerHTML = `<span>${select.selectedOptions[0]?.text ?? ''}</span>${chevronIcon}`;
    list.replaceChildren(...[...select.options].map((option) => {
      const selected = option.value === select.value;
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.className = selected ? 'on' : '';
      item.innerHTML = `<span>${option.text}</span>${selected ? checkIcon : ''}`;
      item.onclick = (event) => {
        event.stopPropagation();
        if (!selected) {
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
        }
        close();
      };
      return item;
    }));
  };

  const open = () => {
    render();
    list.hidden = false;
    wrapper.classList.add('open');
  };

  button.onclick = (event) => {
    event.stopPropagation();
    if (list.hidden) open();
    else close();
  };
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  select.addEventListener('change', render);
  render();
  return { render };
}

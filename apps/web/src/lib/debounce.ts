/** 防抖：返回包装函数，最后一次调用后 delay 毫秒才执行；cancel() 取消尚未触发的回调（M18）。 */
export function useDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 300,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };
  wrapped.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return wrapped;
}

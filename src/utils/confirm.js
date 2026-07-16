/**
 * 确认弹窗：通过 IPC 走主进程 dialog.showMessageBox
 * 比 window.confirm 在 Electron 里更可靠（默认配置下 window.confirm 可能被屏蔽）。
 *
 * @param {object} options
 * @param {string} options.title      弹窗标题
 * @param {string} options.message    主消息（粗体显示）
 * @param {string} [options.detail]   补充说明
 * @param {string} [options.confirmText='确定']
 * @param {string} [options.cancelText='取消']
 * @returns {Promise<boolean>} true=点了确认，false=点了取消或主进程弹窗失败
 */
export async function appConfirm({
  title,
  message,
  detail = '',
  confirmText = '确定',
  cancelText = '取消'
}) {
  if (!window.electronAPI?.showMessageBox) {
    // 兜底：在普通浏览器里降级到 window.confirm
    return window.confirm(`${title}\n\n${message}${detail ? '\n' + detail : ''}`)
  }
  const res = await window.electronAPI.showMessageBox({
    type: 'warning',
    title,
    message,
    detail,
    buttons: [confirmText, cancelText],
    defaultId: 0,
    cancelId: 1
  })
  return res?.response === 0
}

<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import QRCode from 'qrcode'
import { useUserStore } from '@/stores'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})
const emit = defineEmits(['update:visible', 'login-success', 'sync-favorites'])

const userStore = useUserStore()
const canvasRef = ref(null)

function close() {
  emit('update:visible', false)
}

async function refreshQrcode() {
  await userStore.generateQrCode()
  await nextTick()
  renderQrcode()
}

async function renderQrcode() {
  if (!canvasRef.value || !userStore.qrcodeUrl) return
  try {
    await QRCode.toCanvas(canvasRef.value, userStore.qrcodeUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch (error) {
    console.error('二维码渲染失败:', error)
  }
}

async function handleSyncFavorites() {
  // 通过事件通知 App.vue 调用 playlistStore.mergeBiliFavorites
  emit('sync-favorites')
}

async function handleRestoreUserInfo() {
  try {
    await userStore.fetchUserInfo()
  } catch (error) {
    console.error('刷新用户信息失败:', error)
  }
}

async function handleLogout() {
  if (!confirm('确认要退出登录吗？')) return
  await userStore.logout()
  emit('update:visible', false)
}

function statusText(status) {
  const map = {
    idle: '正在准备...',
    loading: '正在加载二维码...',
    waiting: '请使用 B 站手机客户端扫码登录',
    scanned: '已扫码，请在手机上确认登录',
    success: '登录成功',
    expired: '二维码已失效，请刷新',
    error: '登录失败，请重试'
  }
  return map[status] || userStore.qrcodeMessage || ''
}

watch(() => props.visible, async (val) => {
  if (val) {
    // 如果已登录（cookie 持久化生效），不要刷新二维码，
    // 保持已登录 UI 状态不被打断
    if (userStore.isLoggedIn) {
      return
    }
    if (!userStore.qrcodeUrl || userStore.qrcodeStatus === 'expired') {
      await refreshQrcode()
    } else {
      await nextTick()
      renderQrcode()
    }
  }
})

watch(() => userStore.qrcodeUrl, async (val) => {
  if (val) {
    await nextTick()
    renderQrcode()
  }
})

watch(() => userStore.isLoggedIn, (val) => {
  if (val) {
    emit('login-success')
  }
})

onBeforeUnmount(() => {
  userStore.stopPolling()
})
</script>

<template>
  <div v-if="visible" class="login-overlay" @click.self="close">
    <div class="login-modal">
      <div class="login-header">
        <h2>登录 B 站</h2>
        <button class="close-btn" @click="close">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      <div v-if="!userStore.hasLoginCookie" class="login-content">
        <div class="qrcode-wrapper">
          <div v-if="!userStore.qrcodeUrl" class="qrcode-placeholder">
            {{ userStore.qrcodeStatus === 'loading' ? '正在加载...' : '准备中...' }}
          </div>
          <canvas
            v-show="userStore.qrcodeUrl"
            ref="canvasRef"
            class="qrcode-canvas"
          ></canvas>
        </div>
        <p class="qrcode-status" :class="userStore.qrcodeStatus">
          {{ statusText(userStore.qrcodeStatus) }}
        </p>
        <div class="qrcode-actions">
          <button class="action-btn" @click="refreshQrcode">刷新二维码</button>
        </div>
        <p class="qrcode-hint">
          请打开 B 站手机客户端，扫描上方二维码完成登录。
        </p>
      </div>

      <div v-else class="login-content logged-in">
        <div v-if="userStore.userInfo" class="user-card">
          <img :src="userStore.userInfo.face" :alt="userStore.userInfo.uname" class="user-avatar" @error="$event.target.style.display='none'">
          <div class="user-info">
            <div class="user-name">{{ userStore.userInfo.uname }}</div>
            <div class="user-mid">UID: {{ userStore.userInfo.mid }}</div>
            <div v-if="userStore.userInfo.vipStatus" class="user-vip">大会员</div>
          </div>
        </div>
        <div v-else class="user-card-restoring">
          <p>已保存 B 站登录态</p>
          <p class="muted">正在恢复用户信息...</p>
        </div>
        <p class="logged-hint">已登录 B 站账号</p>
        <div class="login-actions">
          <button class="action-btn primary" @click="handleSyncFavorites" :disabled="userStore.isSyncingFavorites">
            {{ userStore.isSyncingFavorites ? '同步中...' : '同步收藏夹' }}
          </button>
          <button v-if="!userStore.userInfo" class="action-btn" @click="handleRestoreUserInfo">刷新用户信息</button>
          <button class="action-btn danger" @click="handleLogout">退出登录</button>
          <button class="action-btn" @click="close">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.login-modal {
  width: 90%;
  max-width: 380px;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  overflow: hidden;
}
.login-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}
.login-header h2 {
  margin: 0;
  font-size: 17px;
  color: var(--text-primary);
}
.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.close-btn:hover { color: var(--text-primary); }
.login-content {
  padding: 22px 18px 24px;
  text-align: center;
}
.qrcode-wrapper {
  width: 200px;
  height: 200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  position: relative;
}
.qrcode-canvas {
  width: 180px;
  height: 180px;
}
.qrcode-placeholder {
  color: #999;
  font-size: 13px;
}
.qrcode-status {
  margin: 14px 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
}
.qrcode-status.scanned { color: #ff9800; }
.qrcode-status.success { color: #4caf50; }
.qrcode-status.expired,
.qrcode-status.error { color: #e81123; }
.qrcode-actions {
  margin-bottom: 10px;
}
.qrcode-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}
.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  text-align: left;
}
.user-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
}
.user-info { flex: 1; min-width: 0; }
.user-name {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-mid {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.user-vip {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 6px;
  font-size: 11px;
  color: #fff;
  background: #fb7299;
  border-radius: 3px;
}
.logged-hint {
  margin: 14px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.login-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.action-btn {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.action-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.action-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.action-btn.primary {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}
.action-btn.primary:hover:not(:disabled) { opacity: 0.9; }
.action-btn.danger { color: #e81123; border-color: #e81123; }
.action-btn.danger:hover:not(:disabled) { background: #e81123; color: #fff; }
</style>

import { useEffect, useState } from 'react'
import i18n from './i18n'
import { useTauriEvents } from './hooks/useTauriEvents'
import { useTheme } from './hooks/useTheme'
import { useAppStore, type AppConfig } from './stores/appStore'
import { useAuthStore } from './stores/authStore'
import { useRoute } from './lib/router'
import {
  loadOnboardingCompleted,
  getConfig,
  getHistory,
  getHistoryStats,
  getDictionary,
  checkAccessibilityPermission,
} from './lib/tauri'
import { initDeepLinkListener } from './lib/deep-link'
import { LLM_DEFAULT_CONFIG } from './lib/constants'
import { Capsule } from './components/Capsule'
import { Settings } from './components/Settings'
import { History } from './components/History'
import { Onboarding } from './components/Onboarding'
import { MainLayout } from './components/MainLayout'
import { HomePage } from './components/HomePage'
import { UpgradePage } from './components/UpgradePage'
import { AccountPage } from './components/AccountPage'
import { ToastContainer } from './components/Toast'

function normalizeConfig(config: AppConfig): AppConfig {
  const next = { ...config }

  if (next.stt_provider === 'cloud') {
    next.stt_provider = 'openai-whisper'
    next.stt_api_key = ''
  }

  if (next.llm_provider === 'cloud') {
    next.llm_provider = 'openai'
    next.llm_api_key = ''
  }

  if (!next.llm_base_url || next.llm_base_url.includes('/api/proxy')) {
    const defaults = LLM_DEFAULT_CONFIG[next.llm_provider] ?? LLM_DEFAULT_CONFIG.openai
    next.llm_base_url = defaults.baseUrl
    if (!next.llm_model || next.llm_model === 'default') {
      next.llm_model = defaults.model
    }
  }

  if (next.llm_provider === 'deepseek' && next.llm_model === 'deepseek-chat') {
    next.llm_model = LLM_DEFAULT_CONFIG.deepseek.model
  }

  return next
}

function CapsuleApp() {
  useTauriEvents()
  useTheme()

  const setConfig = useAppStore((s) => s.setConfig)

  useEffect(() => {
    getConfig()
      .then((config) => {
        const normalized = normalizeConfig(config)
        setConfig(normalized)
        if (normalized.ui_language && normalized.ui_language !== i18n.language) {
          i18n.changeLanguage(normalized.ui_language)
          localStorage.setItem('ui_language', normalized.ui_language)
        }
      })
      .catch((e) => {
        console.error('Failed to load config in capsule:', e)
      })
  }, [setConfig])

  return <Capsule />
}

function MainApp() {
  useTauriEvents()
  useTheme()

  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted)
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted)
  const setConfig = useAppStore((s) => s.setConfig)
  const setSavedConfig = useAppStore((s) => s.setSavedConfig)
  const setHistory = useAppStore((s) => s.setHistory)
  const setHistoryStats = useAppStore((s) => s.setHistoryStats)
  const setDictionary = useAppStore((s) => s.setDictionary)
  const setAccessibilityTrusted = useAppStore((s) => s.setAccessibilityTrusted)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const { route } = useRoute()

  useEffect(() => {
    loadOnboardingCompleted().then(async (done) => {
      setOnboardingCompleted(done)
      if (done) {
        try {
          const [config, history, historyStats, dictionary] = await Promise.all([
            getConfig(),
            getHistory(200, 0),
            getHistoryStats(),
            getDictionary(),
          ])
          const normalized = normalizeConfig(config)
          setConfig(normalized)
          setSavedConfig(normalized)
          setHistory(history)
          setHistoryStats(historyStats)
          setDictionary(dictionary)
          if (navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
            checkAccessibilityPermission().then((trusted) => {
              setAccessibilityTrusted(trusted)
            })
          }
          if (normalized.ui_language && normalized.ui_language !== i18n.language) {
            i18n.changeLanguage(normalized.ui_language)
            localStorage.setItem('ui_language', normalized.ui_language)
          }
        } catch (e) {
          console.error('Failed to load initial data:', e)
          setLoadError(true)
        }
      }
      setLoaded(true)
    })

    useAuthStore.getState().initialize()
    initDeepLinkListener()
  }, [
    setOnboardingCompleted,
    setConfig,
    setSavedConfig,
    setHistory,
    setHistoryStats,
    setDictionary,
    setAccessibilityTrusted,
  ])

  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!loaded || !user) return

    let lastRefresh = 0
    const throttledRefresh = () => {
      const now = Date.now()
      const { checkoutPending } = useAuthStore.getState()
      if (!checkoutPending && now - lastRefresh < 30_000) return
      lastRefresh = now
      useAuthStore.getState().refreshSubscription()
    }

    const interval = setInterval(
      () => {
        lastRefresh = Date.now()
        useAuthStore.getState().refreshSubscription()
      },
      5 * 60 * 1000,
    )

    window.addEventListener('focus', throttledRefresh)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', throttledRefresh)
    }
  }, [loaded, user])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="text-text-tertiary text-[13px]">Loading...</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <span className="text-error text-[13px]">Failed to load application data.</span>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent text-white rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!onboardingCompleted) return <Onboarding />

  return (
    <MainLayout>
      {route === 'home' && <HomePage />}
      {route === 'settings' && <Settings />}
      {route === 'history' && <History />}
      {route === 'upgrade' && <UpgradePage />}
      {route === 'account' && <AccountPage />}
      <ToastContainer />
    </MainLayout>
  )
}

function App() {
  if (window.location.hash === '#capsule') return <CapsuleApp />
  return <MainApp />
}

export default App

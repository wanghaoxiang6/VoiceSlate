import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../../stores/appStore'
import { saveOnboardingCompleted, updateConfig as saveConfig } from '../../lib/tauri'
import { OnboardingLayout } from './OnboardingLayout'
import { WelcomeStep } from './WelcomeStep'
import { SttSetupStep } from './SttSetupStep'
import { LlmSetupStep } from './LlmSetupStep'
import { QuickTestStep } from './QuickTestStep'
import { DoneStep } from './DoneStep'
import { slideRight } from '../../lib/animations'

const TOTAL_STEPS = 5

const TITLES = [
  {
    title: 'Welcome to VoiceSlate',
    subtitle: 'This local-first build uses your own STT and LLM providers from the start.',
  },
  {
    title: 'Speech Recognition',
    subtitle: 'Choose the provider that turns your voice into text.',
  },
  {
    title: 'AI Polish',
    subtitle: 'Choose the LLM that rewrites, formats, or translates your transcript.',
  },
  {
    title: 'How It Works',
    subtitle: 'Preview the voice to text to polish pipeline before you start.',
  },
  {
    title: 'Setup Complete',
    subtitle: 'You are ready to test with your own API keys.',
  },
] as const

export function Onboarding() {
  const step = useAppStore((s) => s.onboardingStep)
  const setStep = useAppStore((s) => s.setOnboardingStep)
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted)
  const sttTestStatus = useAppStore((s) => s.sttTestStatus)
  const llmTestStatus = useAppStore((s) => s.llmTestStatus)
  const config = useAppStore((s) => s.config)

  const canNext =
    step === 0 || step === 3 || step === 4
      ? true
      : step === 1
        ? sttTestStatus === 'success'
        : llmTestStatus === 'success'

  const persistConfig = async () => {
    try {
      await saveConfig(config)
    } catch {
      // Best-effort save so onboarding can continue even if persistence fails once.
    }
  }

  const handleNext = async () => {
    if (step < TOTAL_STEPS - 1) {
      await persistConfig()
      setStep(step + 1)
      return
    }

    await persistConfig()
    await saveOnboardingCompleted()
    setOnboardingCompleted(true)
  }

  const handleBack = async () => {
    if (step === 0) return
    await persistConfig()
    setStep(step - 1)
  }

  const handleSkip = async () => {
    await persistConfig()
    await saveOnboardingCompleted()
    setOnboardingCompleted(true)
  }

  return (
    <OnboardingLayout
      step={step}
      totalSteps={TOTAL_STEPS}
      title={TITLES[step].title}
      subtitle={TITLES[step].subtitle}
      canNext={canNext}
      canBack={step > 0}
      nextLabel={step === TOTAL_STEPS - 1 ? 'Get Started' : 'Next'}
      onNext={handleNext}
      onBack={handleBack}
      onSkip={handleSkip}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={slideRight}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2 }}
        >
          {step === 0 && <WelcomeStep />}
          {step === 1 && <SttSetupStep />}
          {step === 2 && <LlmSetupStep />}
          {step === 3 && <QuickTestStep />}
          {step === 4 && <DoneStep />}
        </motion.div>
      </AnimatePresence>
    </OnboardingLayout>
  )
}

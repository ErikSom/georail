import styles from './GateScreen.module.css';
import faqStyles from './FaqScreen.module.css';
import { t } from '../i18n';

interface Props {
    onBack: () => void;
}

const QUESTION_KEYS = [
    'isSimulator',
    'flatCities',
    'subscription',
    'trainFloats',
    'outsideNetherlands',
    'uploadTrains',
    'nextUpdate',
] as const;

export default function FaqScreen({ onBack }: Props) {
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{t('faq.title')}</h1>
            <div className={styles.content}>
                <section className={faqStyles.section}>
                    <p className={faqStyles.intro}>{t('faq.intro')}</p>
                </section>

                <div className={faqStyles.list}>
                    {QUESTION_KEYS.map((key) => (
                        <details key={key} className={faqStyles.item}>
                            <summary className={faqStyles.summary}>
                                {t(`faq.q.${key}.q`)}
                            </summary>
                            <div
                                className={faqStyles.answer}
                                dangerouslySetInnerHTML={{ __html: t(`faq.q.${key}.a`) }}
                            />
                        </details>
                    ))}
                </div>

                <button className={faqStyles.backButton} onClick={onBack} aria-label={t('faq.back')}>
                    ← {t('faq.back')}
                </button>
            </div>
        </div>
    );
}

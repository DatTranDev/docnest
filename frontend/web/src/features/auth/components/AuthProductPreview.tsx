import { Icon } from '@/components/ui/Icon';
import { MESSAGE, useI18n } from '@/lib/i18n';

/** Illustrative product preview; never mounts an editor, session or document request. */
export function AuthProductPreview() {
  const { t } = useI18n();
  return (
    <div className="auth-product-preview" aria-hidden="true">
      <div className="auth-preview-heading">
        <Icon name="document" size={19} />
        <span>{t(MESSAGE.authPreviewTitle)}</span>
        <span className="auth-preview-share">
          <Icon name="share" size={15} />
        </span>
      </div>
      <div className="auth-preview-toolbar">
        <Icon name="undo" size={15} />
        <span>{t(MESSAGE.normalText)}</span>
        <b>B</b>
        <i>I</i>
        <u>U</u>
        <Icon name="align-left" size={15} />
      </div>
      <div className="auth-preview-canvas">
        <div className="auth-preview-paper">
          <span className="auth-preview-eyebrow">docsnest / 01</span>
          <h3>{t(MESSAGE.authPreviewTitle)}</h3>
          <p>{t(MESSAGE.authPreviewIntro)}</p>
          <h4>{t(MESSAGE.authPreviewHeading)}</h4>
          <ul>
            <li>{t(MESSAGE.authPreviewStepOne)}</li>
            <li>{t(MESSAGE.authPreviewStepTwo)}</li>
          </ul>
        </div>
      </div>
      <div className="auth-preview-caption">{t(MESSAGE.authPreviewCaption)}</div>
    </div>
  );
}

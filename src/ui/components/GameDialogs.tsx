import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../../state/appStore';
import { useSettingsStore, type GraphicsSetting } from '../../state/settingsStore';
import { GAME } from '../../core/config';
import { COUNTRY_BY_ID } from '../../data/countries';
import { LOCALES, localize, type LocaleCode } from '../../i18n/types';
import type { MessageKey } from '../../i18n/locales/en';
import { SAVE_SLOT_IDS, type SaveSlotId } from '../../save/types';
import { useI18n } from '../hooks/useI18n';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, subtitle, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

function SettingsContent() {
  const { t: tr, locale } = useI18n();
  const setLocale = useSettingsStore((state) => state.setLocale);
  const graphics = useSettingsStore((state) => state.graphics);
  const setGraphics = useSettingsStore((state) => state.setGraphics);
  const persianNumerals = useSettingsStore((state) => state.persianNumerals);
  const setPersianNumerals = useSettingsStore((state) => state.setPersianNumerals);
  const cityMarkers = useSettingsStore((state) => state.cityMarkers);
  const setCityMarkers = useSettingsStore((state) => state.setCityMarkers);
  const panelSide = useSettingsStore((state) => state.panelSide);
  const setPanelSide = useSettingsStore((state) => state.setPanelSide);
  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const setUiScale = useSettingsStore((state) => state.setUiScale);
  const notifications = useSettingsStore((state) => state.notifications);
  const setNotifications = useSettingsStore((state) => state.setNotifications);
  const autosave = useSettingsStore((state) => state.autosave);
  const setAutosave = useSettingsStore((state) => state.setAutosave);
  const defaultDifficulty = useSettingsStore((state) => state.defaultDifficulty);
  const setDefaultDifficulty = useSettingsStore((state) => state.setDefaultDifficulty);
  const reset = useSettingsStore((state) => state.reset);
  const session = useAppStore((state) => state.session);
  const syncSnapshot = useAppStore((state) => state.syncSnapshot);

  const changeLocale = (next: LocaleCode) => {
    setLocale(next);
    if (session) {
      session.locale = next;
      setTimeout(syncSnapshot, 0);
    }
  };

  const graphicsOptions: GraphicsSetting[] = ['auto', 'high', 'balanced', 'low'];
  const graphicsKey = (value: GraphicsSetting) =>
    value === 'auto'
      ? 'settings.quality.auto'
      : value === 'high'
        ? 'settings.quality.high'
        : value === 'balanced'
          ? 'settings.quality.balanced'
          : 'settings.quality.low';

  return (
    <div className="settings">
      <section>
        <h3>{tr('settings.language')}</h3>
        <p className="hint">{tr('settings.languageHint')}</p>
        <div className="language-grid language-grid--compact">
          {LOCALES.map((entry) => (
            <button
              key={entry.code}
              type="button"
              className={`language-card language-card--compact ${locale === entry.code ? 'is-active' : ''}`}
              onClick={() => changeLocale(entry.code)}
              dir={entry.dir}
            >
              <span className="language-card__code">{entry.code.toUpperCase()}</span>
              <span className="language-card__name">{entry.nativeLabel}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{tr('settings.graphics')}</h3>
        <div className="settings-row">
          <span>{tr('settings.quality')}</span>
          <div className="segmented">
            {graphicsOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={graphics === option ? 'is-active' : ''}
                onClick={() => setGraphics(option)}
              >
                {tr(graphicsKey(option) as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-row settings-row--check">
          <span>
            {tr('settings.persianNumerals')}
            <em>{tr('settings.persianNumeralsHint')}</em>
          </span>
          <input
            type="checkbox"
            checked={persianNumerals}
            onChange={(event) => setPersianNumerals(event.target.checked)}
          />
        </label>
        <label className="settings-row settings-row--check">
          <span>
            {tr('settings.cityLabels')}
            <em>{tr('settings.cityLabelsHint')}</em>
          </span>
          <input
            type="checkbox"
            checked={cityMarkers}
            onChange={(event) => setCityMarkers(event.target.checked)}
          />
        </label>
      </section>

      <section>
        <h3>{tr('settings.gameplay')}</h3>
        <div className="settings-row">
          <span>{tr('settings.difficulty')}</span>
          <div className="segmented">
            {(['relaxed', 'standard', 'hardened'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={defaultDifficulty === entry ? 'is-active' : ''}
                onClick={() => setDefaultDifficulty(entry)}
              >
                {tr(`nation.difficulty.${entry}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-row settings-row--check">
          <span>{tr('settings.notifications')}</span>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(event) => setNotifications(event.target.checked)}
          />
        </label>
        <label className="settings-row settings-row--check">
          <span>{tr('settings.autosave')}</span>
          <input
            type="checkbox"
            checked={autosave}
            onChange={(event) => setAutosave(event.target.checked)}
          />
        </label>
      </section>

      <section>
        <h3>{tr('settings.audio')}</h3>
        <label className="settings-row">
          <span>
            {tr('settings.volume')}
            <em>{tr('settings.volumeHint')}</em>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
          />
        </label>
      </section>

      <section>
        <h3>{tr('settings.interface')}</h3>
        <div className="settings-row">
          <span>
            {tr('settings.uiScale')}
            <em>{tr('settings.uiScaleHint')}</em>
          </span>
          <input
            type="range"
            min={85}
            max={125}
            value={Math.round(uiScale * 100)}
            onChange={(event) => setUiScale(Number(event.target.value) / 100)}
          />
        </div>
        <div className="settings-row">
          <span>{tr('settings.panelPosition')}</span>
          <div className="segmented">
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                type="button"
                className={panelSide === side ? 'is-active' : ''}
                onClick={() => setPanelSide(side)}
              >
                {tr(side === 'left' ? 'settings.panelPosition.left' : 'settings.panelPosition.right')}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={reset}>
          {tr('settings.reset')}
        </button>
      </section>

      <section className="settings__about">
        <h3>{tr('settings.about')}</h3>
        <p>{tr('settings.aboutBody')}</p>
        <span className="muted">{tr('app.version', { version: GAME.version })}</span>
      </section>
    </div>
  );
}

function SaveLoadContent({ mode }: { mode: 'save' | 'load' }) {
  const { t: tr, locale, timestamp, n } = useI18n();
  const saves = useAppStore((state) => state.saves);
  const refreshSaves = useAppStore((state) => state.refreshSaves);
  const saveToSlot = useAppStore((state) => state.saveToSlot);
  const loadFromSlot = useAppStore((state) => state.loadFromSlot);
  const deleteSlot = useAppStore((state) => state.deleteSlot);
  const exportSlot = useAppStore((state) => state.exportSlot);
  const importSaveText = useAppStore((state) => state.importSaveText);
  const closeDialog = useAppStore((state) => state.closeDialog);
  const session = useAppStore((state) => state.session);
  const [saveName, setSaveName] = useState(session?.saveName ?? '');
  const [pendingDelete, setPendingDelete] = useState<SaveSlotId | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshSaves();
  }, [refreshSaves]);

  const slots: SaveSlotId[] = mode === 'save' ? ['1', '2', '3', '4', '5'] : [...SAVE_SLOT_IDS];
  const bySlot = new Map(saves.map((summary) => [summary.slot, summary.file]));

  const handleSlot = async (slot: SaveSlotId, occupied: boolean) => {
    if (mode === 'save') {
      if (occupied && !window.confirm(tr('save.confirmOverwrite'))) return;
      await saveToSlot(slot, false, saveName);
      closeDialog();
      return;
    }
    await loadFromSlot(slot);
  };

  return (
    <div className="save-load">
      {mode === 'save' && (
        <label className="settings-row">
          <span>{tr('save.name')}</span>
          <input
            className="input"
            value={saveName}
            maxLength={60}
            placeholder={tr('save.namePlaceholder')}
            onChange={(event) => setSaveName(event.target.value)}
          />
        </label>
      )}
      <div className="slot-list">
        {slots.map((slot) => {
          const file = bySlot.get(slot);
          const label = slot === 'auto' ? tr('save.autosave') : tr('save.slot', { index: n(Number(slot)) });
          const savedCountry = file ? COUNTRY_BY_ID[file.meta.countryId] : undefined;
          return (
            <article key={slot} className={`slot ${file ? 'is-filled' : ''}`}>
              <div className="slot__badge">{label}</div>
              <div className="slot__body">
                {file ? (
                  <>
                    <strong>
                      {file.meta.customName ??
                        (savedCountry ? localize(savedCountry.name, locale) : file.meta.countryName)}
                    </strong>
                    <span className="slot__meta">
                      {tr('time.year', { year: n(file.meta.year, { useGrouping: false }) })} ·{' '}
                      {tr('common.day')} {n(file.meta.day)} ·{' '}
                      {timestamp(file.updatedAt)}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>{tr('save.empty')}</strong>
                    <span className="slot__meta">{tr('save.newSlot')}</span>
                  </>
                )}
              </div>
              <div className="slot__actions">
                {mode === 'save' ? (
                  <button type="button" className="btn btn--small btn--primary" onClick={() => void handleSlot(slot, Boolean(file))}>
                    {file ? tr('save.overwrite') : tr('save.save')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!file}
                    onClick={() => void handleSlot(slot, Boolean(file))}
                  >
                    {tr('save.load')}
                  </button>
                )}
                {file && (
                  <>
                    <button
                      type="button"
                      className="icon-btn icon-btn--small"
                      title={tr('save.export')}
                      onClick={() => void exportSlot(slot)}
                    >
                      ⇩
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--small"
                      title={tr('save.delete')}
                      onClick={() => setPendingDelete(slot)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              {pendingDelete === slot && (
                <div className="slot__confirm">
                  <span>{tr('save.confirmDelete')}</span>
                  <div>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={async () => {
                        await deleteSlot(slot);
                        setPendingDelete(null);
                      }}
                    >
                      {tr('common.confirm')}
                    </button>
                    <button type="button" className="btn btn--small" onClick={() => setPendingDelete(null)}>
                      {tr('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="save-load__footer">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
          {tr('save.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            await importSaveText(await file.text());
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function PauseContent() {
  const { t: tr } = useI18n();
  const snapshot = useAppStore((state) => state.snapshot);
  const openDialog = useAppStore((state) => state.openDialog);
  const closeDialog = useAppStore((state) => state.closeDialog);
  const resumeFromPause = useAppStore((state) => state.resumeFromPause);

  return (
    <div className="pause-menu">
      {snapshot && (
        <div className="pause-menu__summary">
          <strong>{snapshot.country.name}</strong>
          <span>{snapshot.dateLabel}</span>
        </div>
      )}
      <div className="pause-menu__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            resumeFromPause();
            closeDialog();
          }}
        >
          {tr('dialog.resume')}
        </button>
        <button type="button" className="btn" onClick={() => openDialog('save')}>
          {tr('dialog.save')}
        </button>
        <button type="button" className="btn" onClick={() => openDialog('load')}>
          {tr('dialog.load')}
        </button>
        <button type="button" className="btn" onClick={() => openDialog('settings')}>
          {tr('dialog.settings')}
        </button>
        <button type="button" className="btn btn--danger" onClick={() => openDialog('leave')}>
          {tr('dialog.mainMenu')}
        </button>
      </div>
    </div>
  );
}

function LeaveContent() {
  const { t: tr } = useI18n();
  const openDialog = useAppStore((state) => state.openDialog);
  const returnToMenu = useAppStore((state) => state.returnToMenu);

  return (
    <div className="confirm">
      <p>{tr('dialog.confirmMenu')}</p>
      <div className="confirm__actions">
        <button type="button" className="btn btn--danger" onClick={returnToMenu}>
          {tr('dialog.confirm')}
        </button>
        <button type="button" className="btn" onClick={() => openDialog('pause')}>
          {tr('dialog.cancel')}
        </button>
      </div>
    </div>
  );
}

export function GameDialogs() {
  const { t: tr } = useI18n();
  const dialog = useAppStore((state) => state.dialog);
  const closeDialog = useAppStore((state) => state.closeDialog);

  if (dialog === 'none') return null;
  if (dialog === 'settings') {
    return (
      <Modal title={tr('settings.title')} onClose={closeDialog} wide>
        <SettingsContent />
      </Modal>
    );
  }
  if (dialog === 'save' || dialog === 'load') {
    return (
      <Modal
        title={tr('save.title')}
        subtitle={tr('save.subtitle')}
        onClose={closeDialog}
        wide
      >
        <SaveLoadContent mode={dialog} />
      </Modal>
    );
  }
  if (dialog === 'pause') {
    return (
      <Modal title={tr('dialog.pause')} onClose={closeDialog}>
        <PauseContent />
      </Modal>
    );
  }
  return (
    <Modal title={tr('dialog.mainMenu')} onClose={closeDialog}>
      <LeaveContent />
    </Modal>
  );
}

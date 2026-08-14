import styles from '../../components/workspace.module.css';

export default function Loading() {
  return (
    <section className={styles.state} aria-label="Loading workspace" aria-busy="true">
      <span className={styles.stateCode}>Loading</span>
      <div className={styles.loadingLine} />
      <div className={`${styles.loadingLine} ${styles.loadingLineShort}`} />
    </section>
  );
}

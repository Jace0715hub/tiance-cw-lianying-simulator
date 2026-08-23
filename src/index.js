export { createConfig, DEFAULT_CONFIG, FRAMES_PER_SECOND, seconds } from "./config/defaults.js";
export {
  createGearRuntime,
  loadDefaultGearRuntime,
  loadGearTemplate,
} from "./config/gear-template.js";
export {
  LIANYING_CURRENT_BEST_AXIS,
  LIANYING_DEFAULT_RESEARCH_SEEDS,
  LIANYING_DEFAULT_VALUE_TRAINING_SEEDS,
  resolveLianyingResearchPath,
  resolveLianyingResearchPaths,
} from "./config/lianying-research-defaults.js";
export {
  CLOCK_TICKS_PER_FRAME,
  CLOCK_TICKS_PER_MS,
  frameToTicks,
  millisecondsToTicks,
  ticksToFrames,
  ticksToMilliseconds,
} from "./engine/clock.js";
export {
  createIllustrativeDamageOracle,
  createZeroDamageOracle,
} from "./engine/damage-oracle.js";
export { createNativeDamageOracle } from "./damage/native-damage-oracle.js";
export { calculateNativeDamage } from "./damage/native-formula.js";
export {
  applyExpectedEquipmentDamage,
  expectedEquipmentProcCount,
} from "./effects/expected-equipment.js";
export { buildAoxueDamageRow } from "./damage/aoxue-catalog.js";
export {
  calculateFrameTiming,
  createTimedConfig,
  enumerateTimingBands,
} from "./mechanics/timing.js";
export {
  buildWindowCastSchedule,
  compareWindowCoverage,
} from "./mechanics/window-schedule.js";
export { executeActionPack, runRotation } from "./engine/simulator.js";
export {
  LIANYING_POLICY_MODES,
  buildWhitepaperOpener,
  detectLianyingResourceBalanceSignals,
  lianyingResourceBalanceCompoundMutations,
  lianyingResourceBalanceMutations,
  legalLianyingPacks,
  legalMechanicalLianyingPacks,
  labelWhitepaperPack,
  legalWhitepaperPacks,
  optimizeLianyingAxis,
  optimizeLianyingDashOverlay,
  optimizeLianyingNeighborhoodAxis,
  optimizeLianyingReferenceAxis,
  replayWhitepaperLianying,
  searchLianyingAxis,
  searchWhitepaperLianying,
} from "./policies/whitepaper-lianying.js";
export {
  createLianyingOptimizationProfile,
  LIANYING_OPTIMIZATION_PROFILES,
} from "./policies/lianying-optimization-profiles.js";
export {
  evaluateLianyingValueModel,
  evaluateLianyingHybridValueQuota,
  crossValidateLianyingRidgeValueModel,
  evaluateLianyingBaselineQuota,
  fitLianyingRidgeValueModel,
  LIANYING_VALUE_FEATURE_COLUMNS,
  predictLianyingRidgeValue,
  selectLianyingHybridValueWeight,
  selectLianyingRidgeValueModel,
  selectLianyingRidgeValuePolicyBySourceValidation,
} from "./policies/lianying-value-model.js";
export {
  classifyLianyingSuffixFailure,
  buildLianyingValueTrainingRows,
  identifyLianyingThunderSegments,
  lianyingAdaptiveSuffixEndIndex,
  lianyingCorePackDistance,
  lianyingStateValueFeatures,
  lianyingSuffixFailureRepairAxes,
  optimizeLianyingSegmentResynthesis,
  selectLianyingDiverseAxisCandidates,
  selectLianyingLayeredSuffixFailures,
  selectLianyingValueShadowCandidates,
  synthesizeLianyingSegment,
} from "./policies/lianying-segment-resynthesis.js";
export {
  addLianyingValueCenteredTargets,
  lianyingValueDatasetSplit,
  lianyingValueTrainingToCsv,
  lianyingValueTrainingToJsonl,
  prepareLianyingValueTrainingRows,
  summarizeLianyingValueTrainingRows,
} from "./reports/lianying-value-training.js";
export {
  buildLianyingBoundedThunderTemplates,
  buildLianyingFocusedCompanionAnchorTemplate,
  buildLianyingRankedPairThunderTemplates,
  lianyingAnchorCoordinationTemplatesToCsv,
  optimizeLianyingHierarchicalAnchorCoordination,
  optimizeLianyingFocusedCompanionAnchorCoordination,
  optimizeLianyingIterativeFocusedCompanionAnchorCoordination,
  optimizeLianyingRankedPairAnchorCoordination,
  selectLianyingStructuralSeedCandidates,
} from "./policies/lianying-anchor-coordinator.js";
export {
  evaluateLianyingReferenceSuffixValue,
  isLianyingAnchorDriftPackAllowed,
  isLianyingCompanionAnchorPackAllowed,
  isLianyingThunderAnchorPackAllowed,
  lianyingCompanionAnchorRows,
  lianyingAnchorDriftLongTermScore,
  lianyingAnchorDriftScheduleToCsv,
  lianyingAnchorDriftWindow,
  lianyingMultiSegmentAnchorDiagnosticsToCsv,
  optimizeLianyingAnchorDriftResynthesis,
  optimizeLianyingMultiSegmentResynthesis,
  selectLianyingJointBoundaryNodes,
} from "./policies/lianying-multisegment-resynthesis.js";
export {
  lianyingPortfolioStructureKey,
  lianyingSeedPortfolioToCsv,
  optimizeLianyingAnchorDriftPortfolio,
} from "./policies/lianying-seed-portfolio.js";
export {
  lianyingSeedCrossoverToCsv,
  optimizeLianyingSeedCrossovers,
} from "./policies/lianying-seed-crossover.js";
export {
  buildLianyingCrossScheduleBridgePlan,
  buildLianyingCrossoverJointSegment,
  lianyingCrossoverBridgeSegmentIndices,
  optimizeLianyingCrossScheduleBridge,
  optimizeLianyingCrossoverBridge,
  optimizeLianyingCrossoverJointBridge,
} from "./policies/lianying-crossover-bridge.js";
export {
  lianyingCrossoverBridgePortfolioToCsv,
  optimizeLianyingCrossoverBridgePortfolio,
  selectLianyingCrossoverBridgePortfolio,
} from "./policies/lianying-crossover-bridge-portfolio.js";
export { auditWhitepaperAxis } from "./reports/whitepaper-audit.js";
export { analyzeLianyingStructure } from "./reports/lianying-structure-analysis.js";
export {
  extractLianyingAnchorTemplate,
  lianyingAnchorTemplateToCsv,
} from "./reports/lianying-anchor-template.js";
export {
  compareDismountRidePersistence,
  lianyingRowsToActionPacks,
} from "./reports/lianying-model-sensitivity.js";
export {
  buildWhitepaperAxisArtifact,
  whitepaperAxisToCsv,
  whitepaperEquipmentToCsv,
} from "./reports/whitepaper-axis-export.js";
export {
  canonicalPack,
  compareLianyingAxes,
  lianyingConvergenceToCsv,
  packSignature,
} from "./reports/lianying-convergence.js";
export {
  assertState,
  cloneState,
  createInitialState,
  isBuffActive,
  isMountedAt,
} from "./engine/state.js";
export {
  fullMountedOverlap,
  orangeBurstOnFoot,
  orangeBurstThenRide,
  orangeThunderOverlapOnFoot,
  partialOrangeThunderOverlapOnFoot,
  staggeredOrangeAfterThunderOnFoot,
} from "./policies/scenarios.js";
export {
  compileProfileLabel,
  replayProfileRows,
} from "./policies/profile-replay.js";
export {
  buildOrangeLianyingCandidates,
  buildThunderWindows,
  injectOrangeIntoRows,
  profileRowTiming,
  selectOrangeRowsGapAligned,
  selectOrangeRowsOnCooldown,
  selectOrangeRowsThunderAligned,
  windowOverlapTicks,
} from "./policies/orange-injection.js";
export {
  ORANGE_WINDOW_PRIMARY_LABELS,
  rankOrangeWindowRotations,
  replaceProfilePrimary,
} from "./policies/orange-window-search.js";
export { beamSearchThunderWindow } from "./policies/thunder-window-search.js";
export {
  identifyRideThunderPairs,
  moveOrangeSuffix,
  moveRidePrimary,
  moveThunderPrefix,
  orangeRowIndices,
  rideRowIndices,
  thunderRowIndices,
} from "./policies/ride-thunder-binding.js";
export {
  buildLianyingRideThunderUsageTemplates,
} from "./policies/lianying-ride-thunder-templates.js";
export { summarize, timelineRows } from "./reports/summary.js";
export {
  BASELINE_COMPONENT_TO_SKILL,
  buildBaselineAlignment,
} from "./reports/baseline-alignment.js";
export {
  buildLocallyOptimizedOrangeCandidateReport,
  buildOrangeCandidateReport,
  buildThunderOptimizedOrangeCandidateReport,
} from "./reports/orange-candidates.js";
export {
  buildJointCoordinationReport,
  buildRidePlacementReport,
  buildRideThunderBindingReport,
} from "./reports/ride-thunder-binding.js";
export { timelineToCsv, timelineToJson } from "./reports/export.js";
export {
  buildOptimizedAxisArtifact,
  optimizedAxisToCsv,
} from "./reports/optimized-axis-export.js";
export {
  summarizeOrangeWindow,
  summarizeOrangeWindows,
} from "./reports/orange-window.js";

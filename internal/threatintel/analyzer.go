package threatintel

import (
	"fmt"
	"strings"
	"time"
)

type Analyzer struct {
	store *Store
}

func NewAnalyzer(store *Store) *Analyzer {
	return &Analyzer{store: store}
}

func (a *Analyzer) Run(now time.Time) error {
	if a.store == nil {
		return nil
	}
	curStart := now.AddDate(0, 0, -7)
	prevStart := now.AddDate(0, 0, -14)
	curSamples, err := a.store.ListSamplesWithResultsSince(curStart)
	if err != nil {
		return err
	}
	prevSamples, err := a.store.ListSamplesWithResultsSince(prevStart)
	if err != nil {
		return err
	}
	aggCurrent := aggregateTechniques(filterWindow(curSamples, curStart, now))
	aggPrev := aggregateTechniques(filterWindow(prevSamples, prevStart, curStart))
	for technique, current := range aggCurrent {
		prev := aggPrev[technique]
		trend := current.DetectedRatio - prev.DetectedRatio
		flagged := (current.SampleCount >= 3 && current.DetectedRatio >= 0.40) || trend >= 0.20
		if err := a.store.UpsertTechniqueSignal(TechniqueSignal{
			TechniqueKey:  technique,
			WindowStart:   curStart,
			WindowEnd:     now,
			SampleCount:   current.SampleCount,
			DetectedRatio: current.DetectedRatio,
			Trend:         trend,
			Flagged:       flagged,
		}); err != nil {
			return err
		}
		state := "closed"
		severity := "info"
		reason := "no elevated detection trend"
		if flagged {
			state = "open"
			if current.DetectedRatio >= 0.60 {
				severity = "high"
			} else {
				severity = "medium"
			}
			reason = fmt.Sprintf("detected_ratio=%.2f sample_count=%d trend=%.2f", current.DetectedRatio, current.SampleCount, trend)
		}
		var closedAt *time.Time
		if state == "closed" {
			t := now.UTC()
			closedAt = &t
		}
		if err := a.store.UpsertTechniqueFlag(TechniqueFlag{
			TechniqueKey:      technique,
			Severity:          severity,
			Reason:            reason,
			OpenedAt:          now.UTC(),
			ClosedAt:          closedAt,
			State:             state,
			LastDetectedRatio: current.DetectedRatio,
			LastSampleCount:   current.SampleCount,
		}); err != nil {
			return err
		}
	}
	return nil
}

type aggregate struct {
	SampleCount   int
	DetectedCount int
	DetectedRatio float64
}

func aggregateTechniques(samples []SampleWithResult) map[string]aggregate {
	stats := map[string]aggregate{}
	for _, s := range samples {
		techniques := deriveTechniqueSet(s)
		isDetected := s.EngineCount > 0 && s.DetectedCount > 0
		for t := range techniques {
			cur := stats[t]
			cur.SampleCount++
			if isDetected {
				cur.DetectedCount++
			}
			if cur.SampleCount > 0 {
				cur.DetectedRatio = float64(cur.DetectedCount) / float64(cur.SampleCount)
			}
			stats[t] = cur
		}
	}
	return stats
}

func deriveTechniqueSet(s SampleWithResult) map[string]bool {
	out := map[string]bool{}
	tierKey := strings.TrimSpace(strings.ToLower(s.Tier))
	if tierKey != "" {
		out["tier:"+tierKey] = true
	}
	if s.PolymorphicMode {
		out["polymorphic_mode"] = true
	}
	if s.LowEntropy {
		out["low_entropy"] = true
	}
	for _, p := range s.Protections {
		k := strings.TrimSpace(strings.ToLower(p))
		if k != "" {
			out[k] = true
		}
	}
	for _, p := range s.Passes {
		k := strings.TrimSpace(strings.ToLower(p))
		if k != "" {
			out["pass:"+k] = true
		}
	}
	return out
}

func filterWindow(samples []SampleWithResult, start, end time.Time) []SampleWithResult {
	var out []SampleWithResult
	for _, s := range samples {
		if (s.SubmittedAt.Equal(start) || s.SubmittedAt.After(start)) && s.SubmittedAt.Before(end) {
			out = append(out, s)
		}
	}
	return out
}

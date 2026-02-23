package threatintel

import "testing"

func TestParseVTFileResponse(t *testing.T) {
	body := []byte(`{
		"data":{
			"id":"abc",
			"attributes":{
				"sha256":"deadbeef",
				"last_analysis_stats":{"harmless":60,"malicious":2,"suspicious":1,"undetected":10,"timeout":0}
			}
		}
	}`)
	info, err := parseVTFileResponse(body)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if info.DetectedCount != 3 || info.EngineCount != 73 {
		t.Fatalf("unexpected parsed counts: %+v", info)
	}
}

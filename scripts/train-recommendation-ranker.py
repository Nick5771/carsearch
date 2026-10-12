#!/usr/bin/env python3
"""Train a shadow ranker from a D1 recommendation_measurements SQLite export.

Only qualified Home impressions are examples. Outbound clicks are useful
actions, not purchases. Evaluation is chronological; activation requires a
separate controlled experiment. No synthetic data is used by this command.
"""
import argparse
import json
import math
import sqlite3
from pathlib import Path

FEATURES = ('baseScore', 'attributeScore', 'repeatPenalty', 'sharedScore')


def probability(weights, values):
    z = weights[0] + sum(w * x for w, x in zip(weights[1:], values))
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def auc(labels, scores):
    positives = sum(labels)
    negatives = len(labels) - positives
    if not positives or not negatives:
        raise ValueError('Evaluation needs both useful and non-useful impressions')
    ordered = sorted(zip(scores, labels))
    total = 0
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][0] == ordered[index][0]:
            end += 1
        rank = (index + 1 + end) / 2
        total += rank * sum(y for _, y in ordered[index:end])
        index = end
    return (total - positives * (positives + 1) / 2) / (positives * negatives)


def train(rows):
    if len(rows) < 500:
        raise ValueError('Need at least 500 qualified, matured impressions; no model was produced')
    boundary = rows[int(len(rows) * .8)]['at']
    training = [r for r in rows if r['at'] < boundary]
    evaluation = [r for r in rows if r['at'] >= boundary]
    if len(training) < 300 or len(evaluation) < 100:
        raise ValueError('Insufficient chronological coverage; collect more days of observations')
    for dataset in (training, evaluation):
        if sum(r['label'] for r in dataset) < 20 or sum(not r['label'] for r in dataset) < 20:
            raise ValueError('Need at least 20 positive and 20 negative outcomes in each split')
    weights = [0.0] * (len(FEATURES) + 1)
    for _ in range(600):
        gradient = [0.0] * len(weights)
        for row in training:
            error = probability(weights, row['values']) - row['label']
            for i, x in enumerate([1.0] + row['values']):
                gradient[i] += error * x
        for i in range(len(weights)):
            weights[i] -= .15 * (gradient[i] / len(training) + (.01 * weights[i] if i else 0))
    labels = [r['label'] for r in evaluation]
    predicted = [probability(weights, r['values']) for r in evaluation]
    baseline = [r['values'][0] + .24 * r['values'][1] for r in evaluation]
    learned_auc = auc(labels, predicted)
    baseline_auc = auc(labels, baseline)
    log_loss = -sum(y * math.log(max(1e-8, p)) + (1-y) * math.log(max(1e-8, 1-p)) for y, p in zip(labels, predicted)) / len(labels)
    return {'version': 1, 'policy': 'shopping-v226', 'mode': 'shadow', 'features': list(FEATURES),
            'weights': weights, 'training_examples': len(training), 'evaluation_examples': len(evaluation),
            'evaluation': {'auc': learned_auc, 'baseline_auc': baseline_auc, 'log_loss': log_loss},
            'eligible_for_experiment': learned_auc > baseline_auc + .01,
            'activation': 'Requires a controlled real-user experiment; offline AUC is not purchase lift'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    database = sqlite3.connect(f'file:{args.database.resolve()}?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    # The current day is excluded so examples have time to accumulate outcomes.
    data = database.execute("SELECT * FROM recommendation_measurements WHERE qualified=1 AND surface='home' AND policy='shopping-v226' AND day < date('now','-1 day') ORDER BY exposed_at").fetchall()
    rows = []
    for row in data:
        features = json.loads(row['features'])
        if not all(k in features and isinstance(features[k], (int, float)) and math.isfinite(features[k]) for k in FEATURES):
            continue
        rows.append({'at': row['exposed_at'], 'values': [max(-2, min(2, features[k])) for k in FEATURES],
                     'label': int(not row['rejected'] and any(row[k] for k in ('liked', 'saved', 'shared', 'compared', 'clicked')))})
    try:
        model = train(rows)
    except ValueError as error:
        parser.exit(2, str(error) + '\n')
    args.output.write_text(json.dumps(model, indent=2) + '\n')
    print(f'Shadow model saved; held-out AUC {model["evaluation"]["auc"]:.3f}, baseline {model["evaluation"]["baseline_auc"]:.3f}. Live ranking was not changed.')


if __name__ == '__main__':
    main()

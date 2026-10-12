import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('ranker', Path(__file__).parent.parent / 'scripts/train-recommendation-ranker.py')
ranker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ranker)
rows = [{'at': i, 'values': [0.0, 0.0, float(i % 2), 0.0], 'label': 1 - i % 2} for i in range(600)]
model = ranker.train(rows)
assert model['mode'] == 'shadow'
assert model['evaluation']['auc'] > .95
assert model['evaluation']['baseline_auc'] == .5
assert model['weights'][3] < 0
assert ranker.auc([0, 1, 0, 1], [.2, .2, .2, .2]) == .5
assert ranker.probability([1000, 1], [1]) <= 1
try:
    ranker.train(rows[:100])
except ValueError:
    pass
else:
    raise AssertionError('Sparse datasets must not produce a model')
print('PASS: training learns outcome direction, chronological evaluation, tied-score AUC, numerical stability, shadow-only output and insufficient-data rejection')

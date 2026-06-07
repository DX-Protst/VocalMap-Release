from setuptools import setup
from Cython.Build import cythonize

extensions = [
    "acoustic_engine/analyzer.py",
    "separation.py"
]

setup(
    ext_modules=cythonize(
        extensions,
        compiler_directives={'language_level': "3", 'always_allow_keywords': True}
    )
)

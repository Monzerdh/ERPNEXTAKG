from setuptools import setup, find_packages


def _parse_requirements(path):
    """Read requirements.txt, dropping blank lines and # comments. setuptools'
    install_requires does NOT support comment syntax, so we filter manually.
    Returns an empty list if the file is missing or all-comments.
    """
    try:
        with open(path) as f:
            return [
                line.strip()
                for line in f.read().splitlines()
                if line.strip() and not line.strip().startswith("#")
            ]
    except FileNotFoundError:
        return []


setup(
    name="akg_ess",
    version="0.1.7",
    description="Employee Self-Service PWA for AKG Contracting (attendance, leaves, petty cash).",
    author="AKG Contracting",
    author_email="it@akg.ae",
    license="MIT",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=_parse_requirements("requirements.txt"),
)

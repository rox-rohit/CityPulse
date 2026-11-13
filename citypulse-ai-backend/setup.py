from setuptools import setup, find_packages

setup(
    name="citypulse-ai-backend",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "geoalchemy2",
        "geopandas",
        "pandas",
        "shapely",
        "osmnx",
        "psycopg2-binary",
    ],
    python_requires=">=3.9",
)